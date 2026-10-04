import crypto from 'node:crypto';
import {localTime,monday} from './time.mjs';
import {buildPlan,selectDaily} from './planner.mjs';
import {complete,decodeSolution,solutionPrompt} from './providers.mjs';
export class Agent {
  constructor(store,platform,options={}) {
    this.store=store;this.platform=platform;this.complete=options.complete||complete;
    this.sleep=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
    this.now=options.now||(()=>new Date());this.running=new Map();this.ticking=false;
    for(const j of store.state.jobs) if(j.status==='running'){j.status='queued';for(const t of j.tasks)if(t.status==='solving')t.status='pending';}
    store.save();
  }
  notify(title,message,kind='info',jobId='') {
    const n={id:crypto.randomUUID(),title,message,kind,jobId,createdAt:this.now().toISOString()};
    this.store.state.notifications.unshift(n);this.store.state.notifications=this.store.state.notifications.slice(0,200);this.store.save();
    const url=this.store.state.config.notificationWebhook;
    if(url) fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(n),signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw Error();}).catch(()=>{
      this.store.state.notifications.unshift({...n,id:crypto.randomUUID(),title:'Webhook delivery failed',message:'Notification is saved here; check your webhook connection.',kind:'error'});this.store.state.notifications=this.store.state.notifications.slice(0,200);this.store.save();
    });
  }
  createJob(id,type,questions,extra={}) {
    const existing=this.store.state.jobs.find(j=>j.id===id);if(existing)return existing;
    const j={id,type,status:'queued',createdAt:this.now().toISOString(),tasks:questions.map(p=>({problem:p,status:'pending',attempts:0,feedback:''})),...extra};
    this.store.state.jobs.push(j);this.store.save();return j;
  }
  async daily(date) {
    const existing=this.store.state.jobs.find(j=>j.id==='daily:'+date);if(existing)return existing;
    const {questions,note}=await selectDaily(this.store,this.platform,date);
    if(!questions.length)throw Error('No eligible questions available');
    const job=this.createJob('daily:'+date,'daily',questions,{date,target:this.store.state.config.dailyQuestionCount});
    const day=this.store.state.plan?.days.find(d=>d.date===date);if(day){day.questions=questions.filter(p=>p.selection!=='QOTD').map(({tests,...p})=>p);day.status='queued';this.store.save();}
    if(note)this.notify('Daily question fallback',note,'info',job.id);
    if(questions.length<job.target)this.notify('Question catalog too small','Add more eligible questions to reach the daily target.','error',job.id);
    return job;
  }
  async tick() {
    if(this.ticking)return;this.ticking=true;
    try {
      const c=this.store.state.config, now=this.now(), local=localTime(now,c.timezone);
      if(!this.store.state.plan||this.store.state.plan.start!==monday(local.date))await buildPlan(this.store,this.platform,local.date);
      if(!c.autoMode)return;
      // Live LeetCode work is performed by the Brave extension because only the
      // browser owns the signed-in session. Avoid also running the sandbox job.
      if(!c.leetcode?.enabled&&local.time>=c.dailyStartTime)await this.daily(local.date);
      if(c.contestMode&&!c.leetcode?.enabled) {
        const contests=await this.platform.contests();
        for(const contest of contests) {
          const start=new Date(contest.startAt).getTime(),end=new Date(contest.endAt).getTime();
          if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
          const id='contest:'+contest.id;
          this.store.state.contestReminders ||= {};
          for(const minutes of [30,5]) {
            const reminder=id+':'+start+':'+minutes;
            if(now.getTime()>=start-minutes*60000&&now.getTime()<start&&!this.store.state.contestReminders[reminder]) {
              this.store.state.contestReminders[reminder]=true;
              const time=new Intl.DateTimeFormat('en-IN',{timeZone:c.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(start));
              this.notify('Upcoming test contest',`${contest.name} starts at ${time} (${c.timezone}).`,'info',id);
            }
          }
          if(now.getTime()>=start&&now.getTime()<end&&!this.store.state.jobs.some(j=>j.id===id)) {
            const all=await this.platform.problems(), questions=(contest.problemIds||[]).map(pid=>all.find(p=>p.id===pid)).filter(Boolean);
            if(questions.length){this.createJob(id,'contest',questions,{contestName:contest.name,endAt:contest.endAt});this.notify('Test contest started',contest.name,'info',id);}
          }
        }
      }
      this.pump();
    }catch(e){
      const last=this.store.state.notifications.find(n=>n.title==='Scheduler needs attention');
      if(!last||this.now()-new Date(last.createdAt)>3600000)this.notify('Scheduler needs attention',e.message,'error');
    }finally{this.ticking=false;}
  }
  pump() {
    if(!this.store.state.config.autoMode)return;
    const jobs=this.store.state.jobs.filter(j=>j.status==='queued'&&!this.running.has(j.id)).sort((a,b)=>Number(b.type==='contest')-Number(a.type==='contest'));
    for(const job of jobs) {
      if(this.running.size>=2)break;
      const run=this.runJob(job).catch(()=>{job.status='failed';this.store.save();this.notify('Agent failure','Unexpected failure; task history is saved.','error',job.id);}).finally(()=>{this.running.delete(job.id);this.pump();});
      this.running.set(job.id,run);
    }
  }
  chooseProvider() {
    const s=this.store.state,today=localTime(this.now(),s.config.timezone).date;
    let changed=false;
    for(const [provider,blocked] of Object.entries(s.disabledProviders)) {
      const quota=blocked.kind==='quota'||blocked.reason==='API quota or balance unavailable';
      if(quota&&blocked.since&&(localTime(new Date(blocked.since),s.config.timezone).date<today||this.now()-new Date(blocked.since)>=30*60000)){delete s.disabledProviders[provider];delete s.providerHealth?.[provider];changed=true;}
    }
    if(changed)this.store.save();
    return s.config.providerOrder.find(p=>this.store.secret(p)&&!s.disabledProviders[p]);
  }
  async solveTask(job,task) {
    const c=this.store.state.config;
    while(task.attempts<c.maxAttempts) {
      if(!this.store.state.config.autoMode){task.status='pending';return 'paused';}
      if(job.endAt&&this.now()>=new Date(job.endAt)){task.status='failed';task.feedback='Contest deadline reached';return 'failed';}
      const provider=this.chooseProvider();
      if(!provider){task.status='blocked';task.feedback='No working API key. Add or reconnect a provider.';return 'blocked';}
      const prompt=solutionPrompt(task.problem,c.language,task.feedback);
      const date=localTime(this.now(),c.timezone).date, reserve=Math.ceil(prompt.length/3)+c.maxOutputTokens;
      const usage=this.store.state.usage[date] ||= {tokens:0,calls:0};
      if(usage.tokens+reserve>c.dailyTokenBudget){task.status='blocked';task.feedback='Daily token budget reached';return 'blocked';}
      usage.tokens+=reserve;usage.calls++;task.attempts++;task.status='solving';task.provider=provider;this.store.save();
      let waitSeconds=Math.min(c.maxRetrySeconds,c.retryBaseSeconds*2**(task.attempts-1));
      try {
        const result=await this.complete(provider,this.store.secret(provider),c.models[provider],prompt,c);
        this.store.state.providerActivity={provider,fallbackFrom:provider!==c.providerOrder[0]?c.providerOrder[0]:null,at:this.now().toISOString()};
        this.store.providerResult(provider,'working');
        if(Number.isFinite(result.tokens)&&result.tokens>=0) usage.tokens=Math.max(0,usage.tokens-reserve+result.tokens);
        this.store.save();
        const solution=decodeSolution(result.text);
        task.solution=solution;
        if(job.endAt&&this.now()>=new Date(job.endAt)){task.status='failed';task.feedback='Contest deadline reached before submission';this.store.save();return 'failed';}
        const judged=await this.platform.submit(task.problem,solution,c.language,`${job.id}:${task.problem.id}`);
        task.feedback=String(judged.feedback||'').slice(0,2000);
        if(judged.accepted===true){task.status='accepted';task.submissionId=judged.submissionId||'';task.completedAt=this.now().toISOString();this.store.save();return 'accepted';}
      }catch(e) {
        task.feedback=e.message;
        if(e.kind)this.store.providerResult(provider,e.kind,e.message);
        if(['key','quota','request'].includes(e.kind)) {
          this.store.state.disabledProviders[provider]={reason:e.message,kind:e.kind,since:this.now().toISOString()};
          this.notify(`${provider} API needs attention`,e.message+(this.chooseProvider()?' — trying the configured backup.':' — reconnect a key to resume.'),'error',job.id);
          this.store.save();
          if(!this.chooseProvider()){task.status='blocked';return 'blocked';}
          waitSeconds=0;
        }else if(e.retryAfter)waitSeconds=Math.min(c.maxRetrySeconds,Math.max(waitSeconds,e.retryAfter));
        // Infrastructure errors (judge unavailable) should not burn eight paid calls.
        if(!e.kind){task.status='blocked';this.store.save();return 'blocked';}
      }
      this.store.save();
      if(task.attempts<c.maxAttempts&&waitSeconds)await this.sleep(waitSeconds*1000);
    }
    task.status='failed';this.store.save();
    this.notify(`${c.maxAttempts}-attempt limit reached`,`${task.problem.title}: ${task.feedback}. Manual retry is available.`,'error',job.id);
    return 'failed';
  }
  async runJob(job) {
    job.status='running';this.store.save();
    if(this.chooseProvider()&&this.store.state.config.platform.type==='sandbox'&&this.platform.judge.ready) {
      try{await this.platform.judge.ready(this.store.state.config.language);}catch(e){job.status='blocked';this.store.save();this.notify('Judge setup required',e.message,'error',job.id);return;}
    }
    for(const task of job.tasks) {
      if(task.status==='accepted')continue;
      const outcome=await this.solveTask(job,task);
      if(outcome==='paused'){job.status='queued';this.store.save();return;}
      if(outcome==='blocked'){job.status='blocked';this.store.save();this.notify('Task paused',task.feedback,'error',job.id);return;}
    }
    const accepted=job.tasks.filter(t=>t.status==='accepted').length;
    job.status=accepted===(job.target||job.tasks.length)?'completed':'failed';job.finishedAt=this.now().toISOString();this.store.save();
    try{await buildPlan(this.store,this.platform,localTime(this.now(),this.store.state.config.timezone).date);}catch{this.notify('Plan refresh delayed','Results are saved. The next planner refresh will retry.','error',job.id);}
    this.notify(job.status==='completed'?'Session completed':'Session incomplete',`${job.contestName||job.date}: ${accepted}/${job.target||job.tasks.length} accepted.`,job.status==='completed'?'success':'error',job.id);
  }
  retry(id) {
    const job=this.store.state.jobs.find(j=>j.id===id);if(!job)throw Error('Unknown job');
    if(this.running.has(id))throw Error('Job already running');
    if(job.status==='completed')return job;
    for(const t of job.tasks)if(t.status!=='accepted'){t.status='pending';t.attempts=0;}
    job.status='queued';delete job.finishedAt;this.store.save();this.pump();return job;
  }
  resumeBlocked() {
    for(const job of this.store.state.jobs)if(job.status==='blocked'){
      if(job.endAt&&this.now()>=new Date(job.endAt))continue;
      if(job.tasks.some(t=>t.status!=='accepted'&&t.attempts>=this.store.state.config.maxAttempts))continue;
      for(const t of job.tasks)if(t.status==='blocked')t.status='pending';job.status='queued';
    }
    this.store.save();this.pump();
  }
}
