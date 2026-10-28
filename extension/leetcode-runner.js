const TERMINAL = new Set(['completed', 'prepared', 'review', 'failed', 'blocked', 'stopped', 'interrupted']);
const ACTIVE = new Set(['discovering', 'running', 'stopping']);
const DAILY_SUBMISSION_LIMIT = 2;
const codeFingerprint = code => {
  const normalized=String(code||'').trim().replace(/\r\n/g,'\n');
  let hash=2166136261;
  for(let i=0;i<normalized.length;i++)hash=Math.imul(hash^normalized.charCodeAt(i),16777619);
  return `${normalized.length}:${hash>>>0}`;
};
export const hasAcceptedQotd = run => (run?.tasks||[]).some(t=>t.problem?.selection==='QOTD'&&t.status==='accepted');
export const automaticRunKey = (date, username) => username ? `automatic:${date}:${username.toLowerCase()}` : date;
export function dailyRunForAccount(runs, date, username) {
  if (!username) return runs[date] || null;
  return runs[automaticRunKey(date, username)] ||
    (runs[date]?.username?.toLowerCase() === username.toLowerCase() ? runs[date] : null);
}
export function latestArchivedAutomaticRun(runs,date,username) {
  if(!username)return null;
  return Object.values(runs).filter(run=>run.mode==='automatic'&&run.date===date&&
    run.username?.toLowerCase()===username.toLowerCase()&&run.id?.startsWith('automatic-history:')&&
    ['failed','blocked','interrupted','review','prepared','completed'].includes(run.status))
    .sort((a,b)=>(b.finishedAt||b.startedAt||'').localeCompare(a.finishedAt||a.startedAt||''))[0]||null;
}

// Keep the old attempt in history, but free today's date key when the user
// deliberately moves the schedule after a stopped/failed automatic test.
export function archiveRetryableAutomaticRun(runs, date, archiveId, allottedCount=null) {
  const run = runs[date];
  if (!run || run.mode !== 'automatic' || ACTIVE.has(run.status)) return false;
  const accepted=(run.tasks||[]).filter(t=>t.status==='accepted').length;
  const target=allottedCount??run.target;
  if(run.status==='review'&&Number.isInteger(target)&&accepted>=target&&hasAcceptedQotd(run))return false;
  if(['completed','prepared'].includes(run.status)&&!(Number.isInteger(allottedCount)&&(accepted<allottedCount||!hasAcceptedQotd(run))))return false;
  runs[archiveId] = {...run, id: archiveId};
  delete runs[date];
  return true;
}

export function shouldRetryForLaterSchedule(run, config, now = new Date()) {
  if (!run || run.mode !== 'automatic' || ['completed','prepared','review'].includes(run.status) || ACTIVE.has(run.status) || !run.startedAt) return false;
  const current = localClock(config.timezone, now);
  const started = localClock(config.timezone, new Date(run.startedAt));
  return started.date === current.date && started.time < config.dailyStartTime && current.time >= config.dailyStartTime;
}

export function automaticRetryDecision(run, config, now = new Date()) {
  const clock = localClock(config.timezone, now);
  if (!config.autoMode || !config.leetcode?.enabled) return {due:false, reason:'Auto Mode is off'};
  if (clock.time < config.dailyStartTime) return {due:false, reason:`Scheduled for ${config.dailyStartTime}`};
  if (!run) return {due:true, reason:'Scheduled time passed; starting now'};
  if (run.reviewRequired) return {due:false, reason:'Submission safety limit reached; review this question before trying again'};
  if ((run.tasks || []).filter(t=>t.status==='accepted').length >= config.dailyQuestionCount&&hasAcceptedQotd(run)) return {due:false, reason:'Daily target completed'};
  if (['review','prepared','completed'].includes(run.status)) return {due:true,reason:'The full daily allotment still needs accepted results; resuming remaining questions.'};
  if (ACTIVE.has(run.status)) return {due:false, reason:'Daily run is in progress'};
  if (run.status === 'stopped') return {due:false, reason:'Stopped manually; use Retry today to resume'};
  if (!['failed','blocked','interrupted'].includes(run.status)) return {due:false, reason:'Daily run is already scheduled'};
  if (run.status === 'interrupted') return {due:true, reason:'Interrupted run found; resuming after browser restart'};
  const nextAt=run.nextRetryAt || (run.finishedAt?new Date(new Date(run.finishedAt).getTime()+(config.automaticRetryMinutes||60)*60000).toISOString():'');
  return !nextAt || now >= new Date(nextAt)
    ? {due:true, reason:'Scheduled retry is due', nextAt}
    : {due:false, reason:`Retry at ${new Intl.DateTimeFormat('en-IN',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(nextAt))}`, nextAt};
}

export function nextHourlyRetryAt(config, now = new Date()) {
  const clock=localClock(config.timezone,now);
  const minutes=clock.time.split(':').map(Number),start=config.dailyStartTime.split(':').map(Number);
  const elapsed=minutes[0]*60+minutes[1]-start[0]*60-start[1];
  const interval=config.automaticRetryMinutes||60;
  const untilNext=elapsed<0?-elapsed:interval-elapsed%interval;
  return new Date(now.getTime()-now.getSeconds()*1000-now.getMilliseconds()+untilNext*60000).toISOString();
}

export function localClock(timeZone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`};
}
export function readinessTarget(config,now=new Date()){
  const clock=localClock(config.timezone,now),current=Number(clock.time.slice(0,2))*60+Number(clock.time.slice(3)),start=Number(config.dailyStartTime.slice(0,2))*60+Number(config.dailyStartTime.slice(3));
  const until=(start-current+1440)%1440;
  if(until>0&&until<=10&&current>start)return new Date(Date.parse(clock.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  return current>=start-10?clock.date:null;
}

export function loginPrecheckDue(config, now = new Date(), lastCheckAt = 0) {
  if (!config.autoMode || !config.leetcode?.enabled) return false;
  const clock=localClock(config.timezone,now);
  const [hour,minute]=clock.time.split(':').map(Number);
  const [startHour,startMinute]=config.dailyStartTime.split(':').map(Number);
  const minutesUntilStart=startHour*60+startMinute-hour*60-minute;
  if(minutesUntilStart<1||minutesUntilStart>10)return false;
  if(!lastCheckAt)return true;
  const last=localClock(config.timezone,new Date(lastCheckAt));
  return last.date!==clock.date||last.time<clock.time&&
    (startHour*60+startMinute-Number(last.time.slice(0,2))*60-Number(last.time.slice(3)))>10;
}

// Daily runs retain the date key for compatibility. Each manual click has a
// separate key and cannot replace the automatic daily result.
export class LeetCodeRunner {
  constructor(io) { this.io = io; this.active = null; }

  async recover(retryResults=false,username='') {
    const runs = await this.io.load();
    for (const run of Object.values(runs)) {
      if(username&&run.username?.toLowerCase()!==username.toLowerCase())continue;
      if (!ACTIVE.has(run.status)&&!(retryResults&&(run.tasks||[]).some(t=>t.status==='blocked'&&t.submissionId&&t.submissionHistory?.at(-1)?.status==='unknown'))) continue;
      run.status = 'interrupted';
      const uncertain=run.reviewReason==='uncertain-submission'||(run.tasks||[]).some(t=>t.submissionId&&t.submissionHistory?.at(-1)?.status==='unknown');
      run.feedback = 'Browser restarted during this session. Automatic work will resume after the next poll.';
      for (const task of run.tasks || []) {
        if((task.status==='submitting'||retryResults&&task.status==='blocked'&&task.submissionId)&&this.io.result){
          if(task.submissionId){
            try{
              const judged=await this.io.result(task.submissionId,run.username);
              task.status=judged.accepted?'accepted':'failed';task.feedback=judged.feedback||'';
              if(judged.accepted)task.completedAt=this.io.now().toISOString();
              const record=task.submissionHistory?.at(-1);
              if(record){record.status=judged.accepted?'accepted':'rejected';record.submissionId=task.submissionId;}
              continue;
            }catch(error){task.feedback='Result recovery needs attention: '+error.message;}
          }else task.feedback='Submission may have been sent before restart. Check LeetCode submission history before retrying.';
          task.status='blocked';run.status='blocked';run.reviewRequired=true;run.nextResultCheckAt=new Date(this.io.now().getTime()+5*60000).toISOString();continue;
        }
        if (['solving', 'drafting', 'checking', 'testing', 'submitting'].includes(task.status)) task.status = 'interrupted';
      }
      if(uncertain&&!run.tasks.some(t=>t.status==='blocked')){delete run.reviewRequired;delete run.reviewReason;delete run.nextResultCheckAt;}
      if(run.target&&run.tasks.filter(t=>t.status==='accepted').length===run.target&&(run.mode==='manual'||hasAcceptedQotd(run))){run.status='completed';delete run.reviewRequired;run.finishedAt=this.io.now().toISOString();run.feedback='Recovered LeetCode results after browser restart';}
      await this.io.save(run);
    }
  }
  async recordSubmission(slug,submissionId,username){
    const run=this.currentRun;
    if(!run||run.username?.toLowerCase()!==username?.toLowerCase())throw Error('Submission account does not match the active run');
    const task=run.tasks.find(t=>t.problem.titleSlug===slug&&t.status==='submitting');
    if(!task||!/^[a-zA-Z0-9_-]+$/.test(submissionId))throw Error('No matching active submission');
    task.submissionId=submissionId;
    if(task.submissionHistory?.length)task.submissionHistory.at(-1).submissionId=submissionId;
    await this.io.save(run);
  }

  start(config, manual = false, requestedCount = 2, accountUsername = '', requestedSlug = '', resumeTasks = [], retryNumber = 1) {
    if (this.active) return {started: false, reason: 'A session is already running', id: this.active.id};
    if (!config.leetcode?.enabled) throw Error('Enable LeetCode browser mode first');
    if (requestedSlug && (!manual || !/^[a-z0-9-]+$/.test(requestedSlug))) throw Error('Invalid current LeetCode question');
    const manualTarget = Math.max(1, Math.min(100, Math.trunc(Number(requestedCount) || 2)));
    const clock = localClock(config.timezone, this.io.now());
    const id = manual ? `manual:${clock.date}:${this.io.uuid()}` : automaticRunKey(clock.date, accountUsername);
    const controller = new AbortController();
    const active = {id, stop: false, controller};
    this.active = active; // Lock before any asynchronous operation.
    this.done = this.execute(config, manual, clock, active, manualTarget, accountUsername, requestedSlug, resumeTasks, retryNumber).finally(() => {
      if (this.active === active) this.active = null;
      if(this.currentRun?.id===active.id)this.currentRun=null;
    });
    // Keep failures from becoming unhandled if the dashboard has already closed.
    this.done.catch(() => {});
    return {started: true, id};
  }

  stop() {
    if (!this.active) return {stopped: false};
    this.active.stop = true;
    this.active.controller.abort();
    // A submission already sent to LeetCode is polled to a final result. No new
    // generation or submission may begin after this flag has been set.
    return {stopped: true, id: this.active.id};
  }

  async execute(config, manual, clock, active, manualTarget, accountUsername, requestedSlug = '', resumeTasks = [], retryNumber = 1) {
    let run;
    try {
      const runs = await this.io.load();
      if (!manual && (!config.autoMode || clock.time < config.dailyStartTime || TERMINAL.has(dailyRunForAccount(runs,clock.date,accountUsername)?.status))) return;
      const acceptedResume=structuredClone(resumeTasks).filter(t=>t.status==='accepted');
      const resumeLimit=acceptedResume.some(t=>t.problem?.selection==='QOTD')?config.dailyQuestionCount:Math.max(0,config.dailyQuestionCount-1);
      run = {id: active.id, date: clock.date, mode: manual ? 'manual' : 'automatic',
        target: requestedSlug ? 1 : manual ? manualTarget : config.dailyQuestionCount, status: 'discovering',
        startedAt: this.io.now().toISOString(), username:accountUsername, retryNumber,
        tasks: manual ? [] : acceptedResume.slice(0,resumeLimit)};
      this.currentRun=run;
      await this.io.save(run);
      if (active.stop) return await this.finishStopped(run);
      const accountRuns = Object.values(runs).filter(r => !accountUsername || r.username?.toLowerCase() === accountUsername.toLowerCase());
      const priorTasksFor = slug => accountRuns.filter(r=>r.date===clock.date).flatMap(r=>r.tasks||[])
        .filter(t=>t.problem?.titleSlug===slug);
      const excludeSlugs = new Set(accountRuns.flatMap(r =>
        (r.tasks || []).map(t => t.problem?.titleSlug)).filter(Boolean));
      const acceptedTodaySlugs = new Set(accountRuns.filter(r=>r.date===clock.date).flatMap(r=>
        (r.tasks||[]).filter(t=>t.status==='accepted').map(t=>t.problem?.titleSlug)).filter(Boolean));
      const completedCount = accountRuns.reduce((n, r) =>
        n + (r.tasks || []).filter(t => t.status === 'accepted').length, 0);
      const discoverMore = async (count, preferQuestionOfTheDay) => {
        const requireQotd=!manual&&!run.tasks.some(t=>t.problem?.selection==='QOTD');
        const discovered = await this.io.discover({username: accountUsername, count,
          enforceUsername: !!accountUsername, adaptivePractice:config.adaptivePractice,timezone:config.timezone,
          language: config.language, allowedDifficulties: config.allowedDifficulties,
          preferQuestionOfTheDay, requireQotd, selectionMode:manual?'roadmap':'random', requestedSlug,
          excludeSlugs:[...excludeSlugs], acceptedTodaySlugs:[...acceptedTodaySlugs], completedCount});
        if (active.stop) return false;
        if (accountUsername && discovered.username.toLowerCase() !== accountUsername.toLowerCase()) throw Error('LeetCode account changed during this run. Retry with the account currently signed in.');
        run.username = discovered.username;
        if(discovered.qotdNote)run.selectionNote=discovered.qotdNote;
        const fresh = [];
        for (const problem of discovered.questions || []) {
          if (!problem?.titleSlug || run.tasks.some(task => task.problem.titleSlug === problem.titleSlug) ||
            fresh.some(item => item.titleSlug === problem.titleSlug)) continue;
          if (requestedSlug !== problem.titleSlug && excludeSlugs.has(problem.titleSlug) &&
            !(problem.selection==='QOTD'&&(!manual||!acceptedTodaySlugs.has(problem.titleSlug)))&&!(problem.selection==='REVISION'&&!acceptedTodaySlugs.has(problem.titleSlug))) continue;
          fresh.push(problem);
        }
        for (const problem of fresh.slice(0, run.target - run.tasks.length)) {
          excludeSlugs.add(problem.titleSlug);
          const prior=problem.selection==='QOTD'&&problem.alreadyAcceptedToday?accountRuns.flatMap(r=>r.date===clock.date?r.tasks||[]:[]).find(t=>t.status==='accepted'&&t.problem?.titleSlug===problem.titleSlug):null;
          const previous=priorTasksFor(problem.titleSlug).at(-1);
          const cached=previous?.solution&&previous.verification?.ok&&!previous.submissionAttempts&&!previous.submissionHistory?.length&&(previous.status==='review'||/Pre-submit check unavailable|network|429|timed out/i.test(previous.feedback||''));
          run.tasks.push(prior?{...structuredClone(prior),problem,status:'accepted'}:{problem,status:'pending',attempts:0,feedback:previous?.feedback?`Previous attempt: ${previous.feedback}${previous.solution?.code?'\nPrevious draft:\n'+previous.solution.code.slice(0,3000):''}`:'',previousProvider:previous?.provider,cachedDraft:cached?{...previous.solution,provider:previous.provider}:null});
        }
        if (!fresh.length) return false;
        await this.io.save(run);
        return true;
      };
      for (let pass = 0; run.tasks.length < run.target && pass < 3; pass++) {
        const found = await discoverMore(run.target - run.tasks.length,
          !requestedSlug && pass === 0 && (manual?config.preferQuestionOfTheDay:true));
        if (!found) break;
      }
      if(!manual&&!run.tasks.some(t=>t.problem?.selection==='QOTD'))throw Error('QOTD was not selected; daily target will retry instead of counting random questions');
      if (!run.tasks.length) throw Error('No eligible LeetCode question found');
      if (active.stop) return await this.finishStopped(run);
      if(!manual)run.tasks.sort((a,b)=>Number(b.problem?.selection==='QOTD')-Number(a.problem?.selection==='QOTD'));
      run.status = 'running';
      await this.io.save(run);
      for (const task of run.tasks) {
        const reviewTask=config.reviewBeforeSubmit&&manual;
        const priorTasks=priorTasksFor(task.problem.titleSlug);
        const priorSubmissionKeys=new Set(priorTasks.flatMap(t=>(t.submissionHistory||[]).map(a=>
          a.submissionId?`id:${a.submissionId}`:`attempt:${a.at}:${a.fingerprint}`)));
        const legacySubmissions=priorTasks.filter(t=>!t.submissionHistory?.length).reduce((total,t)=>total+Math.max(0,Number(t.submissionAttempts??t.attempts)||0),0);
        const priorSubmissions=priorSubmissionKeys.size+legacySubmissions;
        const submittedCodes=new Set(priorTasks.flatMap(t=>t.submittedCodeFingerprints||[]));
        task.submissionAttempts ||= 0;
        task.submittedCodeFingerprints ||= [];
        while (task.status !== 'accepted' && task.attempts < config.maxAttempts) {
          if (active.stop) return await this.finishStopped(run);
          if(!reviewTask&&priorSubmissions+task.submissionAttempts>=DAILY_SUBMISSION_LIMIT){
            task.status='failed';task.feedback=`Submission safety limit (${DAILY_SUBMISSION_LIMIT} per question per day) reached. Review the solution before another submission.`;
            run.reviewRequired=true;break;
          }
          if (accountUsername && this.io.session && (await this.io.session()).toLowerCase() !== accountUsername.toLowerCase()) throw Error('LeetCode account changed during this run. Retry with the account currently signed in.');
          const cachedDraft=task.cachedDraft;delete task.cachedDraft;
          if(!cachedDraft)task.attempts++;
          task.status = 'drafting';
          await this.io.save(run);
          if (active.stop) return await this.finishStopped(run);
          let solution;
          try {
            const rejectedCode=task.submittedCodeFingerprints.length?task.solution?.code:'';
            const feedback=rejectedCode?`${task.feedback}\nPreviously rejected code (do not repeat):\n${rejectedCode.slice(0,3000)}`:task.feedback;
            solution = cachedDraft||await this.io.solve(task.problem, feedback, active.controller.signal,
              task.attempts>1?task.provider:task.previousProvider||'',run.id,{username:run.username,automatic:!manual});
            if (active.stop) return await this.finishStopped(run);
            task.provider = solution.provider;
            task.solution = {code: solution.code, explanation: solution.explanation, complexity: solution.complexity,testCases:solution.testCases||[]};
          } catch (error) {
            if (active.stop) return await this.finishStopped(run);
            task.feedback = error.message;
            task.status = 'pending';
            task.retryKind=/key|quota|budget/.test(error.message)?'provider':/login|session|csrf|account/i.test(error.message)?'login':/rate|429|temporary|unavailable|network|timed out|timeout|connection/i.test(error.message)?'network':'solution';
            if (task.retryKind!=='solution'||/contest.*is live/i.test(error.message)) {
              task.status = 'blocked';
              break;
            }
            await this.io.save(run);
            continue;
          }
          task.status='checking';await this.io.save(run);
          try {
            task.verification=await this.io.verify(task.problem,solution.code,active.controller.signal);
            if(!task.verification.ok){task.feedback=task.verification.feedback;task.status='pending';await this.io.save(run);continue;}
          }catch(error){
            if(active.stop)return await this.finishStopped(run);
            task.verification={ok:false,feedback:`Local syntax check unavailable: ${error.message}`};
            task.feedback=task.verification.feedback;task.status='blocked';run.reviewRequired=true;
            await this.io.save(run);break;
          }
          if(active.stop)return await this.finishStopped(run);
          task.status='testing';await this.io.save(run);
          try{
            task.preflightRuns=(task.preflightRuns||0)+1;
            const checked=await this.io.preflight({...task.problem,additionalTestcases:config.additionalChecks?solution.testCases||[]:[]},solution.code,run.username,active.controller.signal);
            if(active.stop)return await this.finishStopped(run);
            task.preflight={ok:!!checked?.ok,extraCases:checked?.extraCases||0,extraStatus:checked?.extraStatus||'',feedback:checked?.feedback||''};
            if(!checked?.ok){
              task.preflightFailures=(task.preflightFailures||0)+1;
              task.feedback=`Run Code failed: ${checked?.feedback||'LeetCode examples did not pass'}`;
              task.status='pending';await this.io.save(run);continue;
            }
          }catch(error){
            if(active.stop)return await this.finishStopped(run);
            task.feedback=`Pre-submit check unavailable: ${error.message}`;task.status='blocked';
            // Rate limits and temporary network failures did not send a judged
            // submission. Let the hourly scheduler try again after recovery.
            if(!/\b429\b|\b5\d\d\b|timed out|timeout|network|fetch failed|connection failed/i.test(error.message))run.reviewRequired=true;
            await this.io.save(run);break;
          }
          const fingerprint=codeFingerprint(solution.code);
          if(reviewTask){
            task.status='review';task.feedback='Syntax and examples passed. Review this draft and submit it yourself on LeetCode.';
            await this.io.save(run);break;
          }
          if(submittedCodes.has(fingerprint)){
            task.feedback=`Generated code repeats an earlier submission. ${task.feedback||'Use a different approach.'}`;
            task.repeatedDrafts=(task.repeatedDrafts||0)+1;
            task.status='pending';await this.io.save(run);
            if(task.repeatedDrafts>=2){task.status='failed';run.reviewRequired=true;break;}
            continue;
          }
          task.status='submitting';await this.io.save(run);
          task.submissionAttempts++;
          task.submittedCodeFingerprints.push(fingerprint);
          submittedCodes.add(fingerprint);
          task.submissionHistory ||= [];
          const submissionRecord={at:this.io.now().toISOString(),provider:task.provider||'unknown',fingerprint,status:'unknown'};
          task.submissionHistory.push(submissionRecord);
          await this.io.save(run);
          try{
            const judged=await this.io.submit(task.problem,solution.code,run.username,active.controller.signal);
            submissionRecord.status=judged.accepted?'accepted':'rejected';submissionRecord.submissionId=judged.submissionId||'';
            task.feedback=judged.feedback||'';
            if(judged.accepted){task.status='accepted';task.submissionId=judged.submissionId||'';task.completedAt=this.io.now().toISOString();await this.io.save(run);continue;}
            task.status='pending';await this.io.save(run);
          }catch(error){
            if(active.stop)return await this.finishStopped(run);
            task.feedback=`Submission result uncertain: ${error.message}`;task.status='blocked';run.reviewRequired=true;run.reviewReason='uncertain-submission';run.nextResultCheckAt=new Date(this.io.now().getTime()+5*60000).toISOString();
            await this.io.save(run);
            break;
          }
        }
        if (!['accepted','blocked','review'].includes(task.status)) task.status = 'failed';
        await this.io.save(run);
        if (task.status === 'blocked') break;
        if(!manual&&task.problem?.selection==='QOTD'&&task.status!=='accepted')break;
      }
      if(!manual&&!hasAcceptedQotd(run))for(const task of run.tasks){
        if(task.status==='pending'){
          task.status='skipped';task.feedback='QOTD must be accepted before other daily questions start.';
        }
      }
      const readyCount = run.tasks.filter(t => t.status === 'accepted').length;
      run.status = readyCount === run.target && (manual||hasAcceptedQotd(run)) ? 'completed' : run.tasks.some(t => t.status === 'blocked') ? 'blocked' : 'failed';
      if(config.reviewBeforeSubmit&&run.tasks.length===run.target&&run.tasks.some(t=>t.status==='review')&&run.tasks.every(t=>['review','accepted'].includes(t.status))&&(manual||hasAcceptedQotd(run)))run.status='review';
      if (run.status === 'blocked') for (const task of run.tasks) if (task.status === 'pending') {task.status='skipped';task.feedback='Earlier question was blocked; retry after fixing the provider.';}
      run.finishedAt = this.io.now().toISOString();
      if (!manual && !['completed','review'].includes(run.status)&&!run.reviewRequired) run.nextRetryAt = nextHourlyRetryAt(config,this.io.now());
      await this.io.save(run);
      await this.notifySummary(run);
      return run;
    } catch (error) {
      if (active.stop && run) return await this.finishStopped(run);
      if (run) {
        run.status = 'blocked'; run.feedback = error.message;
        for (const task of run.tasks) if (['pending','drafting'].includes(task.status)) {task.status='blocked';task.feedback=error.message;}
        run.finishedAt = this.io.now().toISOString();
        if (!manual) run.nextRetryAt = nextHourlyRetryAt(config,this.io.now());
        await this.io.save(run);
      }
      if (run) await this.notifySummary(run);
      else await this.io.notify('leetcode-error', 'LeetCode agent needs attention', error.message);
      return run;
    }
  }

  async notifySummary(run) {
    const accepted=run.tasks.filter(t=>t.status==='accepted').length;
    const failed=run.tasks.find(t=>['blocked','failed','skipped'].includes(t.status));
    const reason=failed?.feedback||run.feedback||'';
    const detail=failed?.problem?.title ? `${failed.problem.title}: ${reason}` : reason;
    const retry=run.status==='review'?' Drafts are ready for your review; submit them yourself on LeetCode.':run.reviewRequired?' Automatic retries are paused pending review.':run.mode==='automatic'&&run.status!=='completed'?' A retry is scheduled.':'';
    await this.io.notify(`leetcode-run:${run.id}`,`${accepted}/${run.target} accepted · ${run.mode==='manual'?'Manual':'Daily'}`,
      `${run.username||'LeetCode'} · ${run.status}.${detail?' '+detail.slice(0,220):''}${retry}`);
  }

  async finishStopped(run) {
    run.status = 'stopped'; run.finishedAt = this.io.now().toISOString();
    for (const task of run.tasks) {
      if (task.status !== 'ready' && task.status !== 'accepted') task.status = 'stopped';
    }
    await this.io.save(run);
    return run;
  }
}
