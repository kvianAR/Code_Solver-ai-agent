(() => {
  function profile(runs,username,date){
    const records=new Map(),topics=Object.create(null),reviews=new Map(),lastOutcomes=new Map();
    for(const run of Object.values(runs||{})){
      if(!username||run.username?.toLowerCase()!==username.toLowerCase())continue;
      for(const task of run.tasks||[]){
        const slug=task.problem?.titleSlug;if(!slug||!/^\d{4}-\d{2}-\d{2}$/.test(run.date||''))continue;
        const key=run.date+':'+slug,old=records.get(key);
        if(!old||task.status==='accepted'||old.task.status!=='accepted')records.set(key,{task,date:run.date});
      }
    }
    for(const {task,date:done} of records.values()){
      const rejected=(task.submissionHistory||[]).some(a=>a.status==='rejected')||(task.preflightFailures||0)>0;
      if(task.status==='accepted'||rejected){
        const previous=lastOutcomes.get(task.problem.titleSlug);if(!previous||done>=previous.date)lastOutcomes.set(task.problem.titleSlug,{task,date:done});
        for(const topic of task.problem.topics||[]){
          const row=topics[topic]||={attempted:0,accepted:0,needsWork:0};row.attempted++;
          if(task.status==='accepted')row.accepted++;if(rejected)row.needsWork++;
        }
      }
      if(task.status==='accepted'){
        const row=reviews.get(task.problem.titleSlug)||{slug:task.problem.titleSlug,title:task.problem.title,dates:[]};
        row.dates.push(done);reviews.set(row.slug,row);
      }
    }
    const weakTopics=Object.entries(topics).sort((a,b)=>(b[1].needsWork/b[1].attempted)-(a[1].needsWork/a[1].attempted)).filter(([,row])=>row.needsWork>0).slice(0,3).map(([topic])=>topic);
    const due=[];
    for(const row of reviews.values()){
      row.dates.sort();const last=row.dates.at(-1),days=[1,3,7,14,30][Math.min(row.dates.length-1,4)];
      const next=new Date(Date.parse(last+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
      if(next<=date&&last<date)due.push({...row,next});
    }
    for(const [slug,row] of lastOutcomes){
      if(row.task.status==='accepted'||row.date>=date)continue;
      const next=new Date(Date.parse(row.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
      if(next<=date){const existing=due.findIndex(r=>r.slug===slug);if(existing>=0)due.splice(existing,1);due.push({slug,title:row.task.problem.title,next,kind:'retry'});}
    }
    due.sort((a,b)=>a.next.localeCompare(b.next)||Number(b.kind==='retry')-Number(a.kind==='retry'));
    return {topics,weakTopics,due};
  }
  globalThis.practicePlanner={profile};
})();
