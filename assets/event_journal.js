/* Immutable Firestore event journal: pure state reducer; works in browser and Node tests. */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EventJournal = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const kinds = new Set(['order','transaction','reference']);
  function valid(x) {
    return x && x.schema === 1 && typeof x.event_id === 'string' &&
      typeof x.record_id === 'string' && kinds.has(x.kind) &&
      ['upsert','delete'].includes(x.action) && Array.isArray(x.parents) &&
      x.parents.every(p => typeof p === 'string') && x.data && typeof x.data === 'object';
  }
  function reduce(events) {
    const unique = new Map();
    for(const x of events) {
      if(!valid(x)) continue;
      const existing = unique.get(x.event_id);
      if(existing && JSON.stringify(existing) !== JSON.stringify(x)) {
        throw new Error('Разные события с одинаковым идентификатором: ' + x.event_id);
      }
      unique.set(x.event_id, x);
    }
    const byRecord = new Map();
    for(const x of unique.values()) {
      const bucket = byRecord.get(x.record_id) || [];
      bucket.push(x);
      byRecord.set(x.record_id,bucket);
    }
    const records = new Map(), conflicts = [];
    for(const [recordId, group] of byRecord) {
      const indices = new Map(group.map(x=>[x.event_id,x]));
      const usedParents = new Set();
      const depthCache = new Map();
      function depth(id,stack=new Set()) {
        if(depthCache.has(id)) return depthCache.get(id);
        if(stack.has(id)) throw new Error('Обнаружена циклическая история: ' + recordId);
        const ev=indices.get(id);
        if(!ev) return 0;
        stack.add(id);
        const result=1 + Math.max(0,...ev.parents.map(p=>depth(p,stack)));
        stack.delete(id); depthCache.set(id,result);return result;
      }
      for(const ev of group) for(const p of ev.parents) if(indices.has(p)) usedParents.add(p);
      const heads=group.filter(ev=>!usedParents.has(ev.event_id))
        .sort((a,b)=>depth(b.event_id)-depth(a.event_id) ||
          String(b.at||'').localeCompare(String(a.at||'')) || b.event_id.localeCompare(a.event_id));
      if(!heads.length) throw Error('У записи нет завершающего события: '+recordId);
      const selected=heads[0];
      records.set(recordId, {id:recordId,kind:selected.kind,data:selected.data,
        revision:depth(selected.event_id),head_op_id:selected.event_id,deleted:selected.action==='delete'});
      if(heads.length>1) conflicts.push({record_id:recordId,heads,selected});
    }
    return {records,conflicts,seen:unique};
  }
  return {reduce,valid};
});
