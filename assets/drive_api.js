/* Google Identity Services OAuth access tokens are kept only in memory.
   Only files created by this app in a visible user Drive folder are accessed. */
'use strict';
const DriveApi = (()=>{
  const BASE='https://www.googleapis.com/drive/v3/files';
  const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
  const SCOPES='https://www.googleapis.com/auth/drive.file';
  const FOLDER='Финансы по заказам - База';
  let token='',expires=0,authorizing=false;
  async function request(url,options={}) {
    if(!token || Date.now()>expires-45000) throw Error('Нужно снова подключить Google Диск.');
    const res=await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+token}});
    if(!res.ok){let detail='';try{const obj=await res.json();detail=obj.error?.message||'';}catch{}
      const err=new Error(`Google Drive: ${res.status} ${detail||res.statusText}`);err.status=res.status;
      if(res.status===401){token='';expires=0;}throw err;}
    return res;
  }
  function connected(){return !!token&&Date.now()<expires-45000;}
  // Each authorization attempt needs a fresh callback and its own Promise.
  // The former cached client kept resolve/reject from the *first* attempt,
  // causing subsequent Google reconnects to hang indefinitely.
  function authorize({returning=false}={}) {
    const clientId=window.FINANCE_GOOGLE_CLIENT_ID||'';
    if(!navigator.onLine) throw Error('Нет интернета. Локальные данные доступны; подключитесь позже.');
    if(authorizing) throw Error('Окно подключения уже открывается. Дождитесь ответа Google.');
    if(!clientId || !clientId.includes('.apps.googleusercontent.com')) throw Error('Сначала заполните google_config.js: OAuth Client ID.');
    if(!window.google?.accounts?.oauth2) throw Error('Модуль Google не загрузился. Проверьте интернет и попробуйте ещё раз.');
    // Start the popup synchronously while handling a real user click.
    // A fresh client prevents stale callbacks when reauthorizing after expiry.
    return new Promise((resolve,reject)=>{
      authorizing=true;
      let done=false;
      const finish=(error,result)=>{
        if(done)return;
        done=true;authorizing=false;
        if(error)reject(error);else resolve(result);
      };
      try{
        const oauth=google.accounts.oauth2.initTokenClient({
          client_id:clientId,scope:SCOPES,
          callback:r=>{
            if(r.error || !r.access_token){finish(Error(r.error_description||r.error||'Google не выдал доступ.'));return;}
            token=r.access_token;
            expires=Date.now()+(Number(r.expires_in)||3000)*1000;
            finish(null,true);
          },
          error_callback:r=>finish(Error(r.type==='popup_closed'?'Окно Google закрыто. Нажмите «Подключить» ещё раз.':r.type||'Авторизация Google прервана'))
        });
        // Returning users need not re-select the account every single time.
        // The existing Drive folder ID still guards against a wrong account.
        oauth.requestAccessToken({prompt:returning?'':'select_account'});
      }catch(err){finish(err);}
    });
  }
  async function list(q,fields='nextPageToken,files(id,name,createdTime)',pageSize=1000){
    let next='',result=[];
    for(let i=0;i<100;i++){
      const params=new URLSearchParams({q,fields,pageSize:String(pageSize)});
      if(next)params.set('pageToken',next);
      const r=await (await request(`${BASE}?${params}`)).json();
      result.push(...(r.files||[]));next=r.nextPageToken;
      if(!next)return result;
    }
    throw Error('Слишком много файлов Google Диска; список не загружен полностью.');
  }
  async function create(name,parent,json){
    const boundary='finance_'+crypto.randomUUID().replaceAll('-','');
    const meta={name,mimeType:'application/json',parents:[parent]};
    const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(meta),`\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(json),`\r\n--${boundary}--\r\n`],{type:`multipart/related; boundary=${boundary}`});
    return (await request(`${UPLOAD}?uploadType=multipart&fields=id,name`,{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body})).json();
  }
  async function createFolder(){
    const r=await request(`${BASE}?fields=id,name`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:FOLDER,mimeType:'application/vnd.google-apps.folder'})});
    return (await r.json()).id;
  }
  async function getFolder(expectedId){
    if(expectedId){
      try { const r=await (await request(`${BASE}/${encodeURIComponent(expectedId)}?fields=id,name,mimeType,trashed`)).json();
        if(!r.trashed&&r.mimeType==='application/vnd.google-apps.folder')return r.id;
      }catch(e){if(e.status!==404)throw e;}
      throw Error('Исходная папка базы недоступна. Возможно, выбран другой Google-аккаунт. Данные на устройстве сохранены; не создавайте новую базу поверх них.');
    }
    const found=await list(`name = '${FOLDER.replaceAll("'","\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    if(found.length>1)throw Error('Найдено несколько папок базы. Оставьте одну и подключитесь повторно.');
    return found[0]?.id||createFolder();
  }
  async function listEvents(folderId){return list(`'${folderId}' in parents and name contains 'event_' and trashed = false`);}
  async function readEvent(fileId){return (await request(`${BASE}/${encodeURIComponent(fileId)}?alt=media`)).json();}
  async function uploadEvent(folderId,event){return create('event_'+event.event_id+'.json',folderId,event);}
  function disconnect(){token='';expires=0;}
  return {authorize,connected,disconnect,getFolder,listEvents,readEvent,uploadEvent};
})();
