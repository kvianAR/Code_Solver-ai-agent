// Aggregates only attempts recorded by this extension version. Archived retries
// can contain copied tasks, so a judged submission id is counted once.
function practiceMetrics(runs, username) {
  const seen=new Set(),questions=new Map(),providers={},result={firstAccepted:0,firstTotal:0,preflightFailures:0,preflightRuns:0,providers};
  for(const run of Object.values(runs||{})){
    if(username&&run.username?.toLowerCase()!==username.toLowerCase())continue;
    for(const task of run.tasks||[]){
      const questionKey=`${run.date}:${run.username?.toLowerCase()}:${task.problem?.titleSlug}`;
      // A task copied to a retry retains its preflight counters.
      const previous=questions.get(questionKey)||{preflightRuns:0,preflightFailures:0,attempts:[]};
      previous.preflightRuns=Math.max(previous.preflightRuns,task.preflightRuns||0);
      previous.preflightFailures=Math.max(previous.preflightFailures,task.preflightFailures||0);
      for(const attempt of task.submissionHistory||[]){
        const key=`${questionKey}:${attempt.at}:${attempt.fingerprint}`;
        if(seen.has(key))continue;
        seen.add(key);previous.attempts.push(attempt);
      }
      questions.set(questionKey,previous);
    }
  }
  for(const item of questions.values()){
    result.preflightRuns+=item.preflightRuns;result.preflightFailures+=item.preflightFailures;
    const judged=item.attempts.filter(a=>['accepted','rejected'].includes(a.status)).sort((a,b)=>a.at.localeCompare(b.at));
    if(judged.length){result.firstTotal++;if(judged[0].status==='accepted')result.firstAccepted++;}
    for(const attempt of judged){
      const name=attempt.provider||'unknown';providers[name]||={accepted:0,rejected:0};providers[name][attempt.status]++;
    }
  }
  return result;
}
globalThis.practiceMetrics=practiceMetrics;
