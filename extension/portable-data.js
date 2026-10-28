(() => {
  const secretFields=new Set(['secrets','adminToken','token','connection','pairingKey','cookies','headers','authorization','vaultKey','key','apiKey']);
  function clean(value,depth=0){
    if(depth>40)throw Error('Backup is too deeply nested');
    if(Array.isArray(value))return value.map(v=>clean(v,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!secretFields.has(k)&&!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>[k,clean(v,depth+1)]));
    return value;
  }
  function runs(value){
    if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length>2000)throw Error('Invalid extension history');
    const allowed=['completed','review','failed','blocked','waiting','retrying','stopped','interrupted','prepared','running','discovering','stopping'];
    const result={};
    for(const [id,row] of Object.entries(value)){
      if(!/^[\w:.-]{1,200}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||!row||!allowed.includes(row.status)||!Array.isArray(row.tasks)||row.tasks.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(row.date||''))throw Error('Invalid run in backup');
      const copy=clean(row);copy.id=id;
      for(const task of copy.tasks){if(!task.problem||typeof task.problem.title!=='string'||typeof task.problem.titleSlug!=='string'||!/^[a-z0-9-]+$/.test(task.problem.titleSlug)||typeof task.status!=='string')throw Error('Invalid task in backup');}
      if(['running','discovering','stopping'].includes(copy.status)){copy.status='stopped';for(const task of copy.tasks)if(!['accepted','review','failed','blocked','skipped'].includes(task.status))task.status='stopped';}
      result[id]=copy;
    }
    return result;
  }
  globalThis.portableData={clean,runs};
})();
