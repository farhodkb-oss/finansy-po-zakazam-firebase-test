'use strict';
import {FinanceCloud} from './firebase_bridge.js';
const GROUPS={customers:'Заказчики',work_types:'Наименования работ',statuses:'Статусы заказов',income:'Виды приходов',expense:'Статьи расходов',payments:'Способы оплаты',counterparties:'Контрагенты'};
const PAGES=[['home','Главная','▦'],['orders','Заказы','▤'],['operations','Операции','⇄'],['references','Справочники','▧'],['reports','Отчёты','▥'],['settings','Настройки','⚙']];
const ICONS={
 home:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 orders:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6M8 10h8M8 14h8M8 18h5"/>',
 operations:'<path d="M4 7h16M15 3l5 4-5 4M20 17H4m5-4-5 4 5 4"/>',
 references:'<path d="M4 4h16v16H4zM9 4v16M12 8h5M12 12h5M12 16h4"/>',
 reports:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 17v-4m4 4V9m4 8V6"/>',
 settings:'<path d="M10 3l-.6 2.1-2 .9-2-.8-2 3.4 1.6 1.5v2l-1.6 1.5 2 3.4 2-.8 2 .9L10 21h4l.6-2.1 2-.9 2 .8 2-3.4-1.6-1.5v-2l1.6-1.5-2-3.4-2 .8-2-.9L14 3z"/><circle cx="12" cy="12" r="2.5"/>',
};
const navIcon=(id)=>`<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
const $=id=>document.getElementById(id);
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
const money=n=>Number(n||0).toLocaleString('ru-RU').replace(/\u00a0/g,' ');
const today=()=>{const t=new Date();return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`};
const day=iso=>iso?iso.split('-').reverse().join('.'):'—';
const firstMonth=()=>today().slice(0,7)+'-01';
const dirtyDate=iso=>iso&&/^\d{4}-\d\d-\d\d$/.test(iso)?iso:'—';
let db=null,bulkMode=false,cloudConflicts=[],remoteHeads=new Map(),cloudEvents=[];
let cloudReady=false,cloudOnline=false,unsubscribeCloud=null,activeUid=null,refreshChain=Promise.resolve();
const inFlight=new Set();
const state={driveStatus:'Firebase: вход не выполнен',page:'home',rows:[],refs:[],orders:[],ops:[],queue:[],session:false,connection:navigator.onLine?'online':'offline',busy:false,refGroup:'income',from:firstMonth(),to:today(),orderSearch:'',opSearch:'',orderFilter:'all',sort:{orders:['order_no',true],operations:['date',false],reports:['order_no',true],references:['name',true]},reportMode:'cash',reportOrderFilter:'all',print:false};

async function openDB(userId){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open('finansy_firestore_v1_'+userId,1);
  r.onupgradeneeded=()=>{const d=r.result;for(const [name,key] of [['records','id'],['queue','op_id'],['meta','key']])if(!d.objectStoreNames.contains(name))d.createObjectStore(name,{keyPath:key});};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
function transaction(stores,mode,cb){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,mode);let answer;
  tx.oncomplete=()=>resolve(answer);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  try{answer=cb(tx);}catch(err){tx.abort();reject(err);}
 });
}
function all(store){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function one(store,key){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function write(store,value){return transaction([store],'readwrite',tx=>tx.objectStore(store).put(value));}
function erase(store,key){return transaction([store],'readwrite',tx=>tx.objectStore(store).delete(key));}
function meta(key){return one('meta',key).then(x=>x?.value);}
function setMeta(key,value){return write('meta',{key,value});}

async function refresh(){
 if(!db)return;
 const [rows,q]=await Promise.all([all('records'),all('queue')]);
 state.rows=rows.filter(r=>!r.deleted);
 state.queue=q.sort((a,b)=>a.at-b.at);
 state.orders=state.rows.filter(r=>r.kind==='order').map(r=>({...r.data,id:r.id,revision:r.revision,dirty:!!state.queue.find(x=>x.record_id===r.id)}));
 state.ops=state.rows.filter(r=>r.kind==='transaction').map(r=>({...r.data,id:r.id,revision:r.revision,dirty:!!state.queue.find(x=>x.record_id===r.id)}));
 state.refs=state.rows.filter(r=>r.kind==='reference').map(r=>({...r.data,id:r.id,revision:r.revision,dirty:!!state.queue.find(x=>x.record_id===r.id)}));
}

function refs(group,onlyActive=true){return state.refs.filter(r=>r.group_code===group&&(!onlyActive||r.is_active)).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.name.localeCompare(b.name,'ru'));}
function opts(group,current='',allowNew=false){let names=refs(group).map(r=>r.name);if(current&&!names.includes(current))names.unshift(current);return names.map(n=>`<option value="${e(n)}">${e(n)}</option>`).join('')}
function input(label,name,value='',type='text',required=false,extra=''){return `<label class="field">${label}<input name="${name}" type="${type}" value="${e(value)}" ${required?'required':''} ${extra}></label>`;}
function sel(label,name,options,current='',extra=''){
 return `<label class="field">${label}<select name="${name}" ${extra}>${options.map(o=>Array.isArray(o)?o:[o,o]).map(([v,t])=>`<option value="${e(v)}" ${String(v)===String(current)?'selected':''}>${e(t)}</option>`).join('')}</select></label>`;
}
function sortItems(rows,table){const [key,ascending]=state.sort[table];return [...rows].sort((a,b)=>{
 let x=a[key],y=b[key];if(x===undefined)x='';if(y===undefined)y='';
 const result=(typeof x==='number'&&typeof y==='number')?x-y:String(x).localeCompare(String(y),'ru',{numeric:true,sensitivity:'base'});
 return ascending?result:-result;
});}
function sortHeader(table,key,title){const [col,asc]=state.sort[table];return `<th class="sortable" data-sort-table="${table}" data-sort-key="${key}">${e(title)} ${col===key?(asc?'↑':'↓'):''}</th>`;}
function table(headers,tbody,empty='Записей пока нет'){
 return `<div class="scroll-table"><table><thead><tr>${headers}</tr></thead><tbody>${tbody}</tbody></table></div>${tbody?'':`<div class="empty"><b>${e(empty)}</b>Добавьте первую запись или измените фильтры.</div>`}`;
}
function orderName(id){return id?state.orders.find(o=>o.id===id)?.order_no||'Удалённый заказ':'Общие';}
function infoBadge(){
 const n=state.queue.length;const issue=cloudConflicts.length>0;
 const cl=issue?'problem':(!navigator.onLine||n||!cloudOnline)?'offline':'';
 const text=issue?`Конфликты: ${cloudConflicts.length}`:!navigator.onLine?'Офлайн':!cloudReady?'Подключение к Firebase…':n?`Ожидает отправки: ${n}`:cloudOnline?'Синхронизировано':'Нет связи с сервером';
 return `<span class="pill ${cl}"><span class="dot"></span>${e(text)}</span>`;
}
function shell(contents){const p=PAGES.find(x=>x[0]===state.page);
 return `<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-logo">↗</div><div><b>Финансы<br>по заказам</b><small>FIREBASE · ONLINE / OFFLINE</small></div></div><nav class="nav">${PAGES.map(([id,label,ico])=>`<button data-page="${id}" class="${state.page===id?'active':''}"><span class="ico">${navIcon(id)}</span>${label}</button>`).join('')}</nav><div class="sidebar-footer">Данные сохраняются на устройстве.<br>После подключения — синхронизация.</div></aside>
 <main class="main"><div class="top"><div><div class="eyebrow">УЧЁТ ДЕНЕЖНЫХ СРЕДСТВ</div><h1>${p[1]}</h1></div><div class="top-right">${infoBadge()}<button class="btn ghost no-print" data-action="sync">↻ Обновить</button></div></div>${contents}</main></div>
 <nav class="bottom-nav">${PAGES.map(([id,label,ico])=>`<button class="${state.page===id?'active':''}" data-page="${id}"><span class="ico">${navIcon(id)}</span>${label}</button>`).join('')}</nav>`;
}
function panelsStat(list){return `<div class="cards">${list.map(([icon,title,num,cls,foot])=>`<div class="card"><div class="card-head"><span class="card-ic ${cls==='green'?'inc-bg':cls==='red'?'exp-bg':'neutral-bg'}">${icon}</span>${title}</div><div class="card-value ${cls}">${money(num)} ${title==='Всего заказов'?'':'<small style="font-size:11px;color:var(--muted)">сум</small>'}</div><div class="card-foot">${foot}</div></div>`).join('')}</div>`;}
function sumOperations(ops){return ops.reduce((r,t)=>(r[t.kind==='income'?'inc':'exp']+=Number(t.amount||0),r),{inc:0,exp:0});}
function inRange(t){return (!state.from||t.date>=state.from)&&(!state.to||t.date<=state.to)}
function dateFilters(){return `<div class="filters no-print">${input('С даты','filter_from',state.from,'date')}${input('По дату','filter_to',state.to,'date')}<button class="btn secondary" data-action="range-all" style="align-self:end">За всё время</button></div>`;}
function sevenDayData(){
 const now=new Date();now.setHours(12,0,0,0);
 const result=[];
 for(let i=6;i>=0;i--){
   const d=new Date(now);d.setDate(now.getDate()-i);
   const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
   result.push({date:iso,...sumOperations(state.ops.filter(t=>t.date===iso))});
 }
 return result;
}
function cashChart(){
 const days=sevenDayData();const maximum=Math.max(1,...days.flatMap(d=>[d.inc,d.exp]));
 const totals=sumOperations(state.ops.filter(t=>days.some(d=>d.date===t.date)));
 const hasData=days.some(d=>d.inc>0||d.exp>0);
 const bars=days.map(d=>{
   const ht=n=>n?Math.max(4,Math.round(n/maximum*112)):0;
   return `<button type="button" class="chart-day" data-action="chart-day" data-date="${d.date}" aria-label="${day(d.date)}: приход ${money(d.inc)} сум, расход ${money(d.exp)} сум">
     <div class="chart-bar-pair">
       <span class="chart-bar income-bar" style="height:${ht(d.inc)}px" title="${day(d.date)} · Приход ${money(d.inc)} сум"></span>
       <span class="chart-bar expense-bar" style="height:${ht(d.exp)}px" title="${day(d.date)} · Расход ${money(d.exp)} сум"></span>
     </div><span class="chart-day-label">${d.date.slice(8)}.${d.date.slice(5,7)}</span>
   </button>`;
 }).join('');
 return `<div class="panel chart-panel"><div class="panel-head"><div><h2>Поступления и расходы за последние 7 дней</h2><p>По календарным дням, отдельно приход и расход</p></div></div>
 <div class="panel-inner"><div class="chart-meta"><div class="chart-legend"><span><i class="legend-dot income-bar"></i>Приход: <b>${money(totals.inc)} сум</b></span><span><i class="legend-dot expense-bar"></i>Расход: <b>${money(totals.exp)} сум</b></span></div>${hasData?'':'<span class="muted">За эти семь дней операций нет.</span>'}</div>
 <div class="cash-chart"><div class="chart-scale"><span>${money(maximum)}</span><span>${money(Math.round(maximum/2))}</span><span>0</span></div><div class="chart-plot"><div class="chart-gridline top"></div><div class="chart-gridline middle"></div><div class="chart-gridline bottom"></div><div class="chart-days">${bars}</div></div></div></div></div>`;
}
function home(){const months=state.ops.filter(inRange),s=sumOperations(months),recent=[...state.ops].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
 return `<div class="hero"><div class="hero-row"><div><div class="hint">Денежная разница за выбранный период</div><div class="hero-value">${money(s.inc-s.exp)} сум</div><small>${day(state.from)} — ${day(state.to)} · Это движение денег, не бухгалтерская прибыль</small></div><div class="mini-actions"><button class="btn primary" data-action="new-income">+ Приход</button><button class="btn ghost" data-action="new-expense">− Расход</button></div></div></div>
 ${panelsStat([['↗','Поступления',s.inc,'green',`${months.filter(x=>x.kind==='income').length} операций`],['↘','Расходы',s.exp,'red',`${months.filter(x=>x.kind==='expense').length} операций`],['▣','Всего заказов',state.orders.length,'',`${state.orders.filter(o=>o.status==='В работе').length} в работе`]])}
 ${cashChart()}
 <div class="panel"><div class="panel-head"><div><h2>Последние операции</h2><p>Все заказы</p></div><button class="btn secondary small no-print" data-page="operations">Показать все →</button></div>${txnTable(recent,'home')}</div>`;
}
function orders(){const filtered=sortItems(state.orders.filter(x=>[x.order_no,x.customer,x.description].join(' ').toLowerCase().includes(state.orderSearch.toLowerCase())),'orders');
 const headers=sortHeader('orders','order_no','Заказ')+sortHeader('orders','customer','Заказчик')+sortHeader('orders','description','Вид работ')+sortHeader('orders','contract_amount','Договор, сум')+sortHeader('orders','status','Статус')+sortHeader('orders','created_date','Дата')+'<th class="no-print">Действия</th>';
 const body=filtered.map(o=>`<tr><td><b>${e(o.order_no)}</b> ${o.dirty?'<span class="tag pending">⏳</span>':''}</td><td>${e(o.customer)}</td><td>${e(o.description)}</td><td class="money">${money(o.contract_amount)}</td><td><span class="tag">${e(o.status)}</span></td><td>${day(o.created_date)}</td><td class="no-print"><div class="action-cell"><button class="btn small secondary" data-action="edit-order" data-id="${o.id}">Изменить</button><button class="btn small danger" data-action="delete-order" data-id="${o.id}">×</button></div></td></tr>`).join('');
 const cards=filtered.map(o=>`<div class="mobile-card"><div class="mobile-card-top"><strong>№ ${e(o.order_no)} · ${e(o.customer)}</strong><span class="tag">${e(o.status)}</span></div><div class="muted">${e(o.description)}</div><div class="mobile-card-bottom"><strong>${money(o.contract_amount)} сум</strong><span class="muted">${day(o.created_date)}</span></div><div class="mini-actions"><button class="btn secondary small" data-action="edit-order" data-id="${o.id}">Изменить</button><button class="btn danger small" data-action="delete-order" data-id="${o.id}">Удалить</button></div></div>`).join('');
 return `<div class="panel"><div class="panel-head"><div><h2>Реестр заказов</h2><p>${filtered.length} записей · сортировка по заголовкам</p></div><button class="btn primary no-print" data-action="new-order">+ Новый заказ</button></div><div class="panel-inner"><div class="filters"><label class="field search">Поиск заказа<input name="search_orders" placeholder="Номер, заказчик или вид работ" value="${e(state.orderSearch)}"></label></div></div><div class="desktop-table">${table(headers,body,'Список заказов пуст')}</div><div class="mobile-list">${cards||'<div class="empty">Заказов пока нет</div>'}</div></div>`;
}
function txnTable(list,sortName='operations'){
 const hasSort=sortName==='operations';const h=(key,title)=>hasSort?sortHeader('operations',key,title):`<th>${title}</th>`;
 const headers=h('date','Дата')+h('kind','Тип')+h('order_no','Заказ')+h('category','Категория')+h('amount','Сумма, сум')+h('payment','Оплата')+h('counterparty','От кого / кому')+h('comment','Примечание')+(hasSort?'<th class="no-print">Действия</th>':'');
 const body=list.map(t=>`<tr><td>${day(t.date)}</td><td><span class="tag ${t.kind}">${t.kind==='income'?'Приход':'Расход'}</span></td><td><b>${e(orderName(t.order_id))}</b></td><td>${e(t.category)}</td><td class="money ${t.kind==='income'?'green':'red'}">${money(t.amount)}</td><td>${e(t.payment)}</td><td>${e(t.counterparty)}</td><td class="muted">${e(t.comment)}</td>${hasSort?`<td class="no-print"><div class="action-cell"><button class="btn secondary small" data-action="edit-txn" data-id="${t.id}">Изменить</button><button class="btn danger small" data-action="delete-txn" data-id="${t.id}">×</button></div></td>`:''}</tr>`).join('');
 const cards=list.map(t=>`<div class="mobile-card"><div class="mobile-card-top"><span class="tag ${t.kind}">${t.kind==='income'?'Приход':'Расход'}</span><strong class="${t.kind==='income'?'green':'red'}">${money(t.amount)} сум</strong></div><div><b>Заказ: ${e(orderName(t.order_id))}</b> · ${e(t.category)}</div><div class="muted">${day(t.date)} · ${e(t.payment)}${t.counterparty?' · '+e(t.counterparty):''}</div>${t.comment?`<div class="muted">${e(t.comment)}</div>`:''}${hasSort?`<div class="mini-actions"><button class="btn small secondary" data-action="edit-txn" data-id="${t.id}">Изменить</button><button class="btn small danger" data-action="delete-txn" data-id="${t.id}">Удалить</button></div>`:''}</div>`).join('');
 return `<div class="desktop-table">${table(headers,body,'Операций пока нет')}</div><div class="mobile-list">${cards||'<div class="empty">Операций пока нет</div>'}</div>`;
}
function operations(){let list=state.ops.filter(x=>inRange(x)&&(!state.opSearch||[x.category,x.comment,x.counterparty,orderName(x.order_id),x.payment].join(' ').toLowerCase().includes(state.opSearch.toLowerCase()))&&(state.orderFilter==='all'||(state.orderFilter==='none'?x.order_id===null:x.order_id===state.orderFilter)));
 list=sortItems(list.map(x=>({...x,order_no:orderName(x.order_id)})),'operations');
 return `<div class="panel"><div class="panel-head"><div><h2>Журнал денежных операций</h2><p>Приходы и расходы по всем заказам</p></div><div class="mini-actions no-print"><button class="btn primary" data-action="new-income">+ Приход</button><button class="btn danger" data-action="new-expense">− Расход</button></div></div><div class="panel-inner no-print"><div class="filters">${input('Период с','filter_from',state.from,'date')}${input('Период по','filter_to',state.to,'date')}<label class="field search">Поиск<input name="search_ops" value="${e(state.opSearch)}" placeholder="Категория, заказ, примечание"></label>${sel('Заказ','order_filter',[['all','Все заказы'],['none','Общие'],...state.orders.map(o=>[o.id,o.order_no])],state.orderFilter)}</div></div>${txnTable(list)}</div><div class="footer-note">Нажмите на название колонки для сортировки по возрастанию / убыванию.</div>`;
}
function references(){const group=state.refGroup;let list=sortItems(refs(group,false),'references');
 const headers=sortHeader('references','name','Название')+sortHeader('references','is_active','Статус')+'<th class="no-print">Действия</th>';
 const body=list.map(x=>`<tr><td><b>${e(x.name)}</b></td><td><span class="tag ${x.is_active?'income':'pending'}">${x.is_active?'Активен':'Отключён'}</span></td><td class="no-print"><div class="action-cell"><button class="btn small secondary" data-action="edit-ref" data-id="${x.id}">Изменить</button><button class="btn small ghost" data-action="toggle-ref" data-id="${x.id}">${x.is_active?'Отключить':'Включить'}</button><button class="btn small danger" data-action="delete-ref" data-id="${x.id}">×</button></div></td></tr>`).join('');
 return `<div class="panel"><div class="panel-head"><div><h2>Редактируемые справочники</h2><p>Добавляйте, переименовывайте и отключайте свои значения</p></div><button class="btn primary no-print" data-action="new-ref">+ Добавить</button></div><div class="refs-tabs no-print">${Object.entries(GROUPS).map(([id,name])=>`<button data-group="${id}" class="${id===group?'active':''}">${name}</button>`).join('')}</div><div class="desktop-table">${table(headers,body,'Справочник пуст')}</div><div class="mobile-list">${list.map(x=>`<div class="mobile-card"><div class="mobile-card-top"><strong>${e(x.name)}</strong><span class="tag ${x.is_active?'income':'pending'}">${x.is_active?'Активен':'Отключён'}</span></div><div class="mini-actions"><button class="btn secondary small" data-action="edit-ref" data-id="${x.id}">Изменить</button><button class="btn ghost small" data-action="toggle-ref" data-id="${x.id}">${x.is_active?'Отключить':'Включить'}</button><button class="btn danger small" data-action="delete-ref" data-id="${x.id}">×</button></div></div>`).join('')||'<div class="empty">Справочник пуст</div>'}</div></div>`;
}
function reportOrderFilter(t){
 return state.reportOrderFilter==='all'||(state.reportOrderFilter==='none'?!t.order_id:t.order_id===state.reportOrderFilter);
}
function selectedReportOperations(){
 return state.ops.filter(t=>inRange(t)&&reportOrderFilter(t));
}
function movementReport(){
 const previous=state.ops.filter(t=>(!state.from||t.date<state.from)&&reportOrderFilter(t));
 const before=sumOperations(previous),opening=before.inc-before.exp;
 const list=[...selectedReportOperations()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 let running=opening;
 const rows=list.map(t=>{
   const inc=t.kind==='income'?Number(t.amount)||0:0;
   const exp=t.kind==='expense'?Number(t.amount)||0:0;
   running+=inc-exp;
   return {...t,inc,exp,running,order_no:orderName(t.order_id)};
 });
 const totals=sumOperations(list);
 return {rows,opening,inc:totals.inc,exp:totals.exp,closing:running};
}
function reportRows(){
 const map=new Map();
 state.orders.filter(o=>state.reportOrderFilter==='all'||state.reportOrderFilter===o.id).forEach(o=>map.set(o.id,{order_no:o.order_no,customer:o.customer,contract:o.contract_amount,inc:0,exp:0}));
 if(state.reportOrderFilter==='all'||state.reportOrderFilter==='none')map.set('none',{order_no:'Общие',customer:'Без заказа',contract:0,inc:0,exp:0});
 selectedReportOperations().forEach(t=>{const r=map.get(t.order_id||'none');if(r)r[t.kind==='income'?'inc':'exp']+=Number(t.amount)});
 return [...map.values()].map(r=>({...r,difference:r.inc-r.exp}));
}
function reportPeriodLabel(){return `${state.from?day(state.from):'начало учёта'} — ${state.to?day(state.to):'все даты'}`;}
function reportPeriodControls(){
 const actions=[['today','Сегодня'],['week','7 дней'],['month','Этот месяц'],['all','Всё время']];
 return `<div class="report-filter-block no-print"><div class="period-buttons">${actions.map(([key,label])=>`<button class="btn small ${((key==='all'&&!state.from&&!state.to))?'primary':'secondary'}" data-action="period-preset" data-period="${key}">${label}</button>`).join('')}</div>
 <div class="filters">${input('Период с','filter_from',state.from,'date')}${input('Период по','filter_to',state.to,'date')}${sel('Заказ','report_order',[['all','Все заказы'],['none','Общие (без заказа)'],...state.orders.map(o=>[o.id,`№ ${o.order_no} · ${o.customer}`])],state.reportOrderFilter)}</div></div>`;
}
function reportControls(){
 return `<div class="panel report-controls"><div class="panel-head"><div><h2>Отчёты за выбранный период</h2><p>Выберите тип отчёта, даты и заказ</p></div></div><div class="panel-inner"><div class="report-tabs no-print"><button class="${state.reportMode==='cash'?'selected':''}" data-action="report-mode" data-mode="cash">Движение денег</button><button class="${state.reportMode==='orders'?'selected':''}" data-action="report-mode" data-mode="orders">По заказам</button></div>${reportPeriodControls()}</div></div>`;
}
function reportSummary(inc,exp,opening=null,closing=null){
 const vals=opening===null?[['Приход',inc,'green'],['Расход',exp,'red'],['Денежная разница',inc-exp,'']]:[['Остаток на начало',opening,''],['Поступило',inc,'green'],['Израсходовано',exp,'red'],['Остаток на конец',closing,'']];
 return `<div class="report-stats">${vals.map(([title,val,cls])=>`<div class="report-stat"><span>${title}</span><b class="${cls}">${money(val)} сум</b></div>`).join('')}</div>`;
}
function reportOrdersView(){
 const rows=sortItems(reportRows(),'reports'),totals=rows.reduce((x,r)=>({inc:x.inc+r.inc,exp:x.exp+r.exp}),{inc:0,exp:0});
 const headers=sortHeader('reports','order_no','Заказ')+sortHeader('reports','customer','Заказчик')+sortHeader('reports','inc','Приход')+sortHeader('reports','exp','Расход')+sortHeader('reports','difference','Разница');
 const body=rows.map(r=>`<tr><td><b>${e(r.order_no)}</b></td><td>${e(r.customer)}</td><td class="money green">${money(r.inc)}</td><td class="money red">${money(r.exp)}</td><td class="money">${money(r.difference)}</td></tr>`).join('');
 const cards=rows.map(r=>`<div class="mobile-card"><b>№ ${e(r.order_no)} · ${e(r.customer)}</b><div class="report-card-line"><span>Приход: <b class="green">${money(r.inc)}</b></span><span>Расход: <b class="red">${money(r.exp)}</b></span></div><div>Разница: <b>${money(r.difference)} сум</b></div></div>`).join('');
 return `<div class="panel report-print"><div class="panel-head"><div><h2>Движение денег по заказам</h2><p>Период: ${reportPeriodLabel()} · Включая заказы без операций</p></div>${reportExportButtons()}</div><div class="panel-inner">${reportSummary(totals.inc,totals.exp)}</div><div class="desktop-table">${table(headers,body,'Заказов нет')}</div><div class="mobile-list">${cards||'<div class="empty">Заказов нет</div>'}</div><div class="panel-inner"><b>Итого:</b> ${money(totals.inc)} − ${money(totals.exp)} = <b>${money(totals.inc-totals.exp)} сум</b></div></div>`;
}
function reportMovementView(){
 const v=movementReport();
 const headers=['Дата','Тип','Заказ','Категория','Оплата','От кого / кому','Приход, сум','Расход, сум','Остаток, сум','Примечание'].map(x=>`<th>${x}</th>`).join('');
 const body=v.rows.map(t=>`<tr><td>${day(t.date)}</td><td>${t.kind==='income'?'Приход':'Расход'}</td><td>${e(t.order_no)}</td><td>${e(t.category)}</td><td>${e(t.payment)}</td><td>${e(t.counterparty)}</td><td class="money green">${t.inc?money(t.inc):'—'}</td><td class="money red">${t.exp?money(t.exp):'—'}</td><td class="money">${money(t.running)}</td><td>${e(t.comment)}</td></tr>`).join('');
 const cards=v.rows.map(t=>`<div class="mobile-card"><div class="mobile-card-top"><span class="tag ${e(t.kind)}">${t.kind==='income'?'Приход':'Расход'}</span><b class="${t.inc?'green':'red'}">${t.inc?'+':'−'}${money(t.inc||t.exp)} сум</b></div><div><b>${day(t.date)} · № ${e(t.order_no)}</b> · ${e(t.category)}</div><div class="muted">${e(t.payment)} · ${e(t.counterparty)}</div>${t.comment?`<div class="muted">${e(t.comment)}</div>`:''}<div>Остаток после операции: <b>${money(t.running)} сум</b></div></div>`).join('');
 return `<div class="panel report-print"><div class="panel-head"><div><h2>Отчёт «Движение денежных средств»</h2><p>Период: ${reportPeriodLabel()} · ${v.rows.length} операций</p></div>${reportExportButtons()}</div><div class="panel-inner">${reportSummary(v.inc,v.exp,v.opening,v.closing)}<div class="report-note">Остаток рассчитан по всем внесённым операциям до начала периода. Это расчётный денежный остаток, не сверенный с банковскими счетами или кассой.</div></div><div class="desktop-table">${table(headers,body,'В выбранном периоде операций нет')}</div><div class="mobile-list">${cards||'<div class="empty">За выбранный период операций нет</div>'}</div><div class="panel-inner"><b>Операций: ${v.rows.length}</b> · Приход ${money(v.inc)} − Расход ${money(v.exp)} = <b>${money(v.inc-v.exp)} сум</b></div></div>`;
}
function reportExportButtons(){return `<div class="mini-actions no-print"><button class="btn secondary small" data-action="csv">⇩ CSV</button><button class="btn ghost small" data-action="pdf">Печать / PDF</button></div>`;}
function reports(){
 if(state.from&&state.to&&state.from>state.to)return reportControls()+'<div class="notification">Дата начала позже даты окончания. Исправьте выбранный период.</div>';
 return reportControls()+(state.reportMode==='cash'?reportMovementView():reportOrdersView())+'<div class="footer-note">Отчёт учитывает локальные несинхронизированные изменения. Для окончательного отчёта дождитесь статуса «Синхронизировано».</div>';
}
function settings(){
 return `<div class="panel"><div class="panel-head"><div><h2>Firebase и данные</h2><p>Cloud Firestore · личная база · офлайн</p></div></div><div class="panel-inner">
 <div class="settings-row"><div><b>Подключение</b><div class="muted">${e(state.driveStatus)} · очередь: ${state.queue.length} · ${e(FinanceCloud.currentUser()?.email||'')}</div></div><button class="btn secondary" data-action="sync">Синхронизировать</button></div>
 <div class="settings-row"><div><b>Резервная копия</b><div class="muted">Сохранить финансовые данные и очередь изменений в JSON.</div></div><button class="btn ghost" data-action="backup">Скачать JSON</button></div>
 <div class="settings-row"><div><b>Справочники по умолчанию</b><div class="muted">Добавить начальные категории только в новую пустую базу.</div></div><button class="btn secondary" data-action="seed-defaults">Создать</button></div>
 <div class="settings-row"><div><b>Импорт старой базы</b><div class="muted">Поддерживает файл IMPORT_IZ_WINDOWS.json. Импорт выполняйте только один раз.</div></div><button class="btn ghost" data-action="import-json">Импорт JSON</button><input id="import-json-file" type="file" accept=".json,application/json" style="display:none"></div>
 <div class="settings-row"><div><b>Выход</b><div class="muted">Выйти из Firebase. При наличии ожидающих операций выход заблокирован.</div></div><button class="btn danger" data-action="logout">Выйти</button></div>
 <div class="notification">Конфликты одновременного изменения одной записи сохраняются как несколько версий — выберите нужную ниже. Данные браузерного офлайн-кэша не шифруются дополнительно; используйте блокировку устройства.</div></div></div>
 ${cloudConflicts.length?`<div class="panel"><div class="panel-head"><h2>Конфликты параллельных изменений: ${cloudConflicts.length}</h2></div><div class="panel-inner">${cloudConflicts.map(c=>`<div class="notification"><b>${e(c.selected.kind)} · ${e(c.record_id)}</b><div class="mini-actions">${c.heads.map((h,i)=>`<button class="btn small secondary" data-action="resolve-cloud" data-id="${e(c.record_id)}" data-head-id="${e(h.event_id)}">Версия ${i+1}: ${e(h.data?.order_no||h.data?.category||h.data?.name||h.at||'изменение')}</button>`).join('')}</div></div>`).join('')}</div></div>`:''}`;
}
function render(){const views={home,orders,operations,references,reports,settings};$('app').innerHTML=shell(views[state.page]());}
function loginScreen(msg=''){
 return `<div class="login-outer"><div class="login-visual"><div class="brand"><div class="brand-logo">↗</div><div><b>Финансы по заказам</b><small>FIREBASE + OFFLINE</small></div></div><div><h1>Заказы и деньги<br>под контролем.</h1><p>Единая база Cloud Firestore на Windows и Android. После первого входа доступна работа без интернета.</p></div><div class="login-ticks"><div>✓ Личная облачная база</div><div>✓ Офлайн-режим</div><div>✓ История изменений и конфликты</div></div></div>
 <div class="login-form"><div class="panel" style="padding:24px"><div class="eyebrow">ВХОД В FIREBASE</div><h2>Финансы по заказам</h2>${msg?`<div class="form-error">${e(msg)}</div>`:''}<form id="auth-form"><label class="field">Email<input name="email" type="email" autocomplete="username" required></label><label class="field">Пароль<input name="password" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Войти в программу →</button></form><div class="footer-note">Используйте email и пароль созданного в Firebase пользователя. Не вводите Google OAuth Client Secret.</div></div></div></div>`;
}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.id);toast.id=setTimeout(()=>el.classList.remove('show'),4200);}
function modal(title,body,submit='Сохранить'){ $('modal-root').innerHTML=`<div class="modal-bg" id="modal-bg"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${e(title)}</h2><button class="x" data-action="close">×</button></div><form id="edit-form"><div class="modal-body">${body}<div class="form-error" id="form-error"></div></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close">Отмена</button><button class="btn primary" type="submit">${submit}</button></div></form></div></div>`;}
function closeModal(){$('modal-root').innerHTML='';}
let modalCommit=null;
function getForm(f){return Object.fromEntries(new FormData(f).entries())}
function orderForm(order){const data=order||{order_no:'',customer:'',description:'',contract_amount:0,created_date:today(),status:'Новый',comment:''};
 const statuses=refs('statuses').map(r=>[r.name,r.name]);if(!statuses.find(x=>x[0]===data.status))statuses.push([data.status,data.status]);
 modal(order?'Изменение заказа':'Новый заказ',
 input('Номер заказа','order_no',data.order_no,'text',true)+input('Дата заказа','created_date',data.created_date,'date',true)+
 `<label class="field">Заказчик<input name="customer" list="cust-list" value="${e(data.customer)}" required><datalist id="cust-list">${opts('customers')}</datalist></label>`+
 `<label class="field">Наименование работы<input name="description" list="work-list" value="${e(data.description)}"><datalist id="work-list">${opts('work_types')}</datalist></label>`+
 input('Стоимость договора, сум','contract_amount',data.contract_amount,'number',true,'min="0" step="1"')+
 sel('Статус','status',statuses,data.status)+`<label class="field span2">Примечание<textarea name="comment">${e(data.comment)}</textarea></label>`);
 modalCommit=async v=>{
  const sum=Number(v.contract_amount);if(!Number.isSafeInteger(sum)||sum<0)throw Error('Введите целую положительную сумму или 0.');
  if(state.orders.some(o=>o.id!==order?.id&&o.order_no.toLowerCase()===v.order_no.trim().toLowerCase()))throw Error('Номер заказа уже существует.');
  const item={order_no:v.order_no.trim(),customer:v.customer.trim(),description:v.description.trim(),contract_amount:sum,created_date:v.created_date,status:v.status,comment:v.comment.trim()};
  if(!item.order_no||!item.customer)throw Error('Заполните номер и заказчика.');
  await stage('order',order?.id||uid(),item,'upsert');
  await addImplicitRef('customers',item.customer);await addImplicitRef('work_types',item.description);
 };
}
function transForm(txn,kind='income'){
 const d=txn||{date:today(),kind,order_id:null,category:'',amount:'',payment:'',counterparty:'',comment:''};
 const group=d.kind==='income'?'income':'expense';
 const typeOptions=[['income','Приход'],['expense','Расход']];
 const categoryOptions=refs(group).map(r=>[r.name,r.name]);
 if(d.category&&!categoryOptions.find(([v])=>v===d.category))categoryOptions.push([d.category,d.category]);
 const payments=refs('payments').map(r=>[r.name,r.name]);if(d.payment&&!payments.find(([v])=>v===d.payment))payments.push([d.payment,d.payment]);
 modal(txn?'Изменить операцию':d.kind==='income'?'Новый приход':'Новый расход',
 input('Дата','date',d.date,'date',true)+sel('Тип','kind',typeOptions,d.kind,'id="tx-kind"')+
 sel('Заказ','order_id',[['','Общие (без заказа)'],...state.orders.map(o=>[o.id,`${o.order_no} · ${o.customer}`])],d.order_id||'')+
 sel('Категория','category',categoryOptions,d.category||categoryOptions[0]?.[0]||'')+
 input('Сумма, сум','amount',d.amount,'number',true,'min="1" step="1"')+
 sel('Способ оплаты','payment',payments,d.payment||payments[0]?.[0]||'')+
 `<label class="field span2">От кого / кому<input name="counterparty" list="cp-list" value="${e(d.counterparty)}"><datalist id="cp-list">${opts('counterparties')}</datalist></label>`+
 `<label class="field span2">Примечание<textarea name="comment">${e(d.comment)}</textarea></label>`);
 modalCommit=async v=>{
  const sum=Number(v.amount);if(!Number.isSafeInteger(sum)||sum<=0)throw Error('Введите положительную целую сумму.');
  if(!v.category||!v.payment)throw Error('Выберите категорию и способ оплаты.');
  if(v.order_id&&!state.orders.find(o=>o.id===v.order_id))throw Error('Заказ не найден.');
  const item={date:v.date,kind:v.kind,order_id:v.order_id||null,category:v.category,amount:sum,payment:v.payment,counterparty:v.counterparty.trim(),comment:v.comment.trim()};
  await stage('transaction',txn?.id||uid(),item,'upsert');
  await addImplicitRef('counterparties',item.counterparty);
 };
}
function referenceForm(r){
 const x=r||{group_code:state.refGroup,name:'',is_active:true,sort_order:Math.max(0,...refs(state.refGroup,false).map(o=>o.sort_order||0))+10};
 modal(r?'Изменить справочник':'Новое значение справочника',`<div class="span2 muted">${e(GROUPS[x.group_code])}</div>`+
 input('Наименование','name',x.name,'text',true,'maxlength="160"')+
 sel('Состояние','is_active',[['true','Активен'],['false','Отключён']],String(x.is_active)));
 modalCommit=async v=>{
  const data={group_code:x.group_code,name:v.name.trim().replace(/\s+/g,' '),is_active:v.is_active==='true',sort_order:x.sort_order};
  if(!data.name)throw Error('Введите наименование.');
  if(state.refs.some(z=>z.id!==r?.id&&z.group_code===data.group_code&&z.name.toLowerCase()===data.name.toLowerCase()))throw Error('Такое значение уже существует.');
  if(r&&r.name!==data.name){
    bulkMode=true;
    try{await stage('reference',r.id,data,'upsert');await applyRefRenameLocal(r,data);}
    finally{bulkMode=false;await refresh();render();}
    void synchronize();
  }else await stage('reference',r?.id||uid(),data,'upsert');
 };
}
async function addImplicitRef(group,name){
 if(!name||state.refs.find(r=>r.group_code===group&&r.name.toLowerCase()===name.toLowerCase()))return;
 await stage('reference',uid(),{group_code:group,name,is_active:true,sort_order:Math.max(0,...refs(group,false).map(x=>x.sort_order||0))+10},'upsert');
}
async function applyRefRenameLocal(old,updated){
 const fieldMap={customers:['order','customer',null],work_types:['order','description',null],statuses:['order','status',null],income:['transaction','category','income'],expense:['transaction','category','expense'],payments:['transaction','payment',null],counterparties:['transaction','counterparty',null]};
 const [kind,field,txKind]=fieldMap[old.group_code];
 for(const r of await all('records')){
  if(r.kind!==kind||r.deleted||(txKind&&r.data.kind!==txKind)||String(r.data[field]||'').toLowerCase()!==old.name.toLowerCase())continue;
  r.data[field]=updated.name;
  await stage(r.kind,r.id,r.data,'upsert');
 }
}
async function stage(kind,id,data,action){
 if(!db||!FinanceCloud.currentUser())throw Error('Войдите в Firebase.');
 if(!cloudReady)throw Error('Дождитесь загрузки сохранённых данных Firebase.');
 const current=await one('records',id);
 const opId=uid();
 const parent=current?.head_op_id||null;
 const row={id,kind,data:data||current?.data,revision:(current?.revision||0)+1,head_op_id:opId,deleted:action==='delete'};
 const job={op_id:opId,record_id:id,kind,action,base_heads:parent?[parent]:[],data:row.data,at:Date.now()};
 await transaction(['records','queue'],'readwrite',tx=>{tx.objectStore('records').put(row);tx.objectStore('queue').put(job);});
 await refresh();if(!bulkMode)render();
 if(!bulkMode)void synchronize();
}
async function doDelete(kind,id){const name=kind==='order'?'заказ':kind==='transaction'?'операцию':'значение справочника';
 if(!confirm(`Удалить ${name}? Использованные значения справочника лучше отключать.`))return;
 const r=await one('records',id);if(!r)return;
 if(kind==='order'&&state.ops.some(t=>t.order_id===id))return toast('Сначала удалите операции этого заказа.');
 if(kind==='reference'){
 const x=state.refs.find(z=>z.id===id);
 if(x){let usage=state.orders.some(o=>(x.group_code==='customers'&&o.customer===x.name)||(x.group_code==='statuses'&&o.status===x.name)||(x.group_code==='work_types'&&o.description===x.name));
 usage=usage||state.ops.some(t=>(x.group_code==='payments'&&t.payment===x.name)||(x.group_code==='counterparties'&&t.counterparty===x.name)||((x.group_code==='income'||x.group_code==='expense')&&t.kind===x.group_code&&t.category===x.name));
 if(usage)return toast('Значение используется. Вместо удаления отключите его.');}
 }
 await stage(kind,id,r.data,'delete');toast('Удаление ожидает синхронизации.');
}
function asEvent(q){return {schema:1,event_id:q.op_id,record_id:q.record_id,kind:q.kind,action:q.action,data:q.data,parents:q.base_heads||[],at:new Date(q.at).toISOString()};}
function onCloudEvents(payload){
 const userId=activeUid;
 refreshChain=refreshChain.then(async()=>{
   if(userId!==activeUid||!db)return;
   cloudEvents=payload.events.filter(EventJournal.valid);
   cloudReady=true; cloudOnline=!payload.fromCache;
   state.driveStatus=cloudOnline?'Firestore подключён':'Офлайн-копия Firebase';
   const queued=await all('queue');
   if(!payload.fromCache){
     for(const q of queued){
       if(payload.confirmedIds.has(q.op_id)){
         await erase('queue',q.op_id);inFlight.delete(q.op_id);
       }
     }
   }
   const active=await all('queue');
   const full=new Map(cloudEvents.map(ev=>[ev.event_id,ev]));
   for(const q of active)full.set(q.op_id,asEvent(q));
   const journal=EventJournal.reduce([...full.values()]);
   remoteHeads=journal.records;cloudConflicts=journal.conflicts;
   await transaction(['records'],'readwrite',tx=>{
     const store=tx.objectStore('records');store.clear();
     for(const row of journal.records.values())store.put(row);
   });
   await refresh();render();
   // Pending jobs created before startup now have durable Firebase enqueue requests.
   void synchronize();
 }).catch(err=>{state.driveStatus='Ошибка Firebase: '+err.message;toast(state.driveStatus);});
}
async function synchronize(){
 if(!db||!FinanceCloud.currentUser())return;
 const queued=await all('queue');
 for(const q of queued){
   if(inFlight.has(q.op_id))continue;
   inFlight.add(q.op_id);
   // Do not await the Promise: Firebase resolves an offline write only after server acknowledgement.
   FinanceCloud.enqueueEvent(asEvent(q)).catch(err=>{
     inFlight.delete(q.op_id);
     state.driveStatus='Ошибка отправки: '+err.message;
     toast(state.driveStatus);render();
   });
 }
 await refresh();render();
}
async function resolveCloud(recordId,eventId){
 const c=cloudConflicts.find(x=>x.record_id===recordId);if(!c)return;
 const winner=c.heads.find(x=>x.event_id===eventId);if(!winner)return;
 const id=uid(),row=remoteHeads.get(recordId);
 const q={op_id:id,record_id:recordId,kind:winner.kind,action:winner.action,data:winner.data,base_heads:c.heads.map(h=>h.event_id),at:Date.now()};
 await transaction(['records','queue'],'readwrite',tx=>{
   tx.objectStore('queue').put(q);
   tx.objectStore('records').put({id:recordId,kind:winner.kind,data:winner.data,revision:(row?.revision||0)+1,head_op_id:id,deleted:winner.action==='delete'});
 });
 await refresh();render();void synchronize();
}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200);}
function csvLine(row){return row.map(x=>{
 const str=String(x??'');const safe=/^[=+@\-\t\r]/.test(str)?"'"+str:str;
 return '"'+safe.replaceAll('"','""')+'"';
}).join(';');}
function exportCSV(){
 if(state.from&&state.to&&state.from>state.to)return toast('Сначала исправьте период отчёта.');
 let lines;
 if(state.reportMode==='cash'){
   const v=movementReport();
   lines=[['Отчёт: движение денег'],['Период',reportPeriodLabel()],['Остаток на начало',v.opening],
     ['Дата','Тип','Заказ','Категория','Способ оплаты','От кого / кому','Приход','Расход','Остаток','Примечание'],
     ...v.rows.map(t=>[day(t.date),t.kind==='income'?'Приход':'Расход',t.order_no,t.category,t.payment,t.counterparty,t.inc,t.exp,t.running,t.comment]),
     ['ИТОГО','','','','','',v.inc,v.exp,v.closing,'']];
 }else{
   const rows=reportRows();const inc=rows.reduce((n,r)=>n+r.inc,0),exp=rows.reduce((n,r)=>n+r.exp,0);
   lines=[['Движение денег по заказам'],['Период',reportPeriodLabel()],['Заказ','Заказчик','Приход','Расход','Разница'],...rows.map(r=>[r.order_no,r.customer,r.inc,r.exp,r.difference]),['ИТОГО','',inc,exp,inc-exp]];
 }
 download(new Blob(['\ufeff',lines.map(csvLine).join('\r\n')],{type:'text/csv;charset=utf-8'}),`finansy_${state.reportMode}_${state.from||'all'}_${state.to||'all'}.csv`);
}
async function exportPDF(){
 if(state.from&&state.to&&state.from>state.to)return toast('Сначала исправьте период отчёта.');
 state.page='reports';render();
 window.print();
 toast('В окне печати выберите «Сохранить как PDF».');
}

async function seedDefaults(){
 const defaults={statuses:['Новый','В работе','Завершён','Отменён'],
   income:['Аванс заказчика','Оплата заказа','Возврат средств','Прочий приход'],
   expense:['Материалы','Зарплата','Услуги подрядчика','Транспорт','Аренда','Коммунальные услуги','Налоги','Прочие расходы'],
   payments:['Наличные','Банк','Карта']};
 bulkMode=true;try{
  for(const [group,names] of Object.entries(defaults))for(let i=0;i<names.length;i++)
   await stage('reference',uid(),{group_code:group,name:names[i],is_active:true,sort_order:(i+1)*10},'upsert');
 }finally{bulkMode=false;await refresh();render();}
}
async function importWindowsJSON(file){
 const content=JSON.parse(await file.text());
 let incoming=[];
 if(content.format==='finansy-windows-export-v1'&&Array.isArray(content.records))incoming=content.records;
 else if(content.format==='finansy-offline-backup-v1'&&Array.isArray(content.rows)){
   if(Array.isArray(content.queue)&&content.queue.length)throw Error('В старой программе есть несинхронизированные записи. Сначала дождитесь синхронизации Google Диска.');
   incoming=content.rows.filter(x=>!x.deleted).map(x=>({id:x.id,kind:x.kind,data:x.data}));
 }else throw Error('Выберите IMPORT_IZ_WINDOWS.json либо резервную копию JSON из старой программы Google Диска.');
 if(!cloudReady||!cloudOnline)throw Error('Перед импортом дождитесь подключения к серверу Firestore.');
 if(state.orders.length||state.ops.length||state.queue.length)throw Error('Импорт разрешён только до появления заказов и операций в новой базе и при пустой очереди.');
 if(incoming.length>3000)throw Error('Для больших баз нужен пакетный импорт.');
 for(const r of incoming){
  if(!['order','transaction','reference'].includes(r.kind)||!/^[a-f0-9-]{36}$/.test(r.id)||!r.data||typeof r.data!=='object')throw Error('Ошибка структуры файла импорта.');
 }
 if(!confirm(`Импортировать ${incoming.length} записей в Firebase? Убедитесь, что сохранена резервная копия старой базы.`))return;
 bulkMode=true;
 try{for(const r of incoming){
   if(r.kind==='reference'&&state.refs.some(x=>x.group_code===r.data.group_code&&x.name.toLowerCase()===String(r.data.name).toLowerCase()))continue;
   await stage(r.kind,r.id,r.data,'upsert');
 }}
 finally{bulkMode=false;await refresh();render();}
 await setMeta('importedWindows',true);
 toast('Импорт добавлен в очередь Firebase. Дождитесь статуса «Синхронизировано».');
 void synchronize();
}
async function backup(){
 const payload={format:'finansy-firestore-backup-v1',date:new Date().toISOString(),records:await all('records'),queue:await all('queue')};
 download(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`finansy_firestore_backup_${today()}.json`);
}
async function logOut(){
 if(state.queue.length)return toast('Нельзя выходить, пока есть ожидающие отправки операции.');
 if(!confirm('Выйти из Firebase? Облачная база сохранится.'))return;
 await FinanceCloud.signOut();
}
async function authChanged(user){
 if(unsubscribeCloud){unsubscribeCloud();unsubscribeCloud=null;}
 if(db){db.close();db=null;}
 activeUid=user?.uid||null;cloudReady=false;cloudOnline=false;inFlight.clear();cloudEvents=[];cloudConflicts=[];remoteHeads=new Map();
 if(!user){state.session=false;state.rows=[];state.ops=[];state.orders=[];state.refs=[];state.queue=[];$('app').innerHTML=loginScreen();return;}
 state.session=true;state.driveStatus='Подключение к Cloud Firestore…';
 db=await openDB(user.uid);await refresh();render();
 unsubscribeCloud=FinanceCloud.listen(onCloudEvents,err=>{state.driveStatus='Ошибка доступа к Firestore: '+err.message;toast(state.driveStatus);render();});
 void synchronize();
}
async function init(){
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 $('app').innerHTML=loginScreen('Проверяем сохранённый вход…');
 FinanceCloud.onAuth(user=>authChanged(user).catch(err=>{$('app').innerHTML=loginScreen(err.message);}));
 window.addEventListener('online',()=>{state.connection='online';void synchronize();});
 window.addEventListener('offline',()=>{state.connection='offline';if(state.session)render();});
}
document.addEventListener('submit',async ev=>{
 if(ev.target.id==='auth-form'){
   ev.preventDefault();const values=getForm(ev.target);
   try{await FinanceCloud.signIn(String(values.email||'').trim(),String(values.password||''));}
   catch(err){$('app').innerHTML=loginScreen('Не удалось войти: '+err.message);}
   return;
 }
 if(ev.target.id==='edit-form'){
  ev.preventDefault();try{await modalCommit(getForm(ev.target));closeModal();toast('Сохранено на устройстве. Отправка выполнится автоматически.');}
  catch(err){const target=$('form-error');if(target)target.textContent=err.message;}
 }
});
document.addEventListener('change',ev=>{
 const x=ev.target;
 if(x.id==='tx-kind'){
  const group=x.value==='income'?'income':'expense';const el=document.querySelector('#edit-form [name="category"]');
  if(el)el.innerHTML=refs(group).map(r=>`<option value="${e(r.name)}">${e(r.name)}</option>`).join('');
 }
 if(x.id==='import-json-file'&&x.files?.[0]){void importWindowsJSON(x.files[0]).catch(err=>toast('Ошибка импорта: '+err.message));}
 if(x.name==='filter_from'){state.from=x.value;render();}
 if(x.name==='filter_to'){state.to=x.value;render();}
 if(x.name==='order_filter'){state.orderFilter=x.value;render();}
 if(x.name==='report_order'){state.reportOrderFilter=x.value;render();}
});
document.addEventListener('input',ev=>{
 const x=ev.target;if(x.name==='search_orders'||x.name==='search_ops'){
  if(x.name==='search_orders')state.orderSearch=x.value;else state.opSearch=x.value;
  const pos=x.selectionStart,name=x.name;render();const y=document.querySelector(`[name="${name}"]`);if(y){y.focus();y.setSelectionRange(pos,pos);}
 }
});
document.addEventListener('click',async ev=>{
 if(ev.target.id==='modal-bg'){closeModal();return;}
 const target=ev.target.closest('[data-page],[data-action],[data-group],[data-sort-table]');if(!target)return;
 if(target.dataset.page){state.page=target.dataset.page;render();window.scrollTo(0,0);return;}
 if(target.dataset.group){state.refGroup=target.dataset.group;render();return;}
 if(target.dataset.sortTable){const tab=target.dataset.sortTable,key=target.dataset.sortKey;const current=state.sort[tab];state.sort[tab]=[key,current[0]===key?!current[1]:true];render();return;}
 const action=target.dataset.action,id=target.dataset.id;
 try{
 switch(action){
 case 'close':closeModal();break;
 case 'sync':await synchronize();toast(cloudOnline?'Firebase: данные проверены':'Ожидаем соединения с Firebase');break;
 case 'import-json':$('import-json-file')?.click();break;
 case 'seed-defaults':if(state.rows.length||state.queue.length){toast('Сначала импортируйте старую базу или используйте пустую базу.');break;}await seedDefaults();void synchronize();break;
 case 'resolve-cloud':await resolveCloud(id,target.dataset.headId);break;
 case 'new-order':orderForm();break;case 'edit-order':orderForm(state.orders.find(o=>o.id===id));break;
 case 'delete-order':await doDelete('order',id);break;
 case 'new-income':transForm(null,'income');break;case 'new-expense':transForm(null,'expense');break;
 case 'edit-txn':transForm(state.ops.find(o=>o.id===id));break;case 'delete-txn':await doDelete('transaction',id);break;
 case 'new-ref':referenceForm();break;case 'edit-ref':referenceForm(state.refs.find(r=>r.id===id));break;
 case 'delete-ref':await doDelete('reference',id);break;
 case 'toggle-ref':{const r=state.refs.find(x=>x.id===id);await stage('reference',id,{group_code:r.group_code,name:r.name,is_active:!r.is_active,sort_order:r.sort_order},'upsert');break;}
 case 'range-all':state.from='';state.to='';render();break;
 case 'report-mode':state.reportMode=target.dataset.mode==='orders'?'orders':'cash';render();break;
 case 'chart-day':{const iso=target.dataset.date;const totals=sumOperations(state.ops.filter(t=>t.date===iso));toast(`${day(iso)}: приход ${money(totals.inc)} сум, расход ${money(totals.exp)} сум`);break;}
 case 'period-preset':{const p=target.dataset.period;const t=new Date();t.setHours(12,0,0,0);const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if(p==='all'){state.from='';state.to='';}else if(p==='today'){state.from=fmt(t);state.to=fmt(t);}else if(p==='month'){state.from=fmt(new Date(t.getFullYear(),t.getMonth(),1));state.to=fmt(t);}else{const d=new Date(t);d.setDate(d.getDate()-6);state.from=fmt(d);state.to=fmt(t);}render();break;}
 case 'backup':await backup();break;case 'logout':await logOut();break;
 case 'csv':exportCSV();break;case 'pdf':await exportPDF();break;case 'print':window.print();break;
 }
 }catch(err){toast('Ошибка: '+err.message);}
});
init().catch(err=>{$('app').innerHTML=`<div class="empty"><b>Не удалось открыть программу</b>${e(err.message)}<p>Для офлайн-работы нужен браузер с поддержкой IndexedDB.</p></div>`});
