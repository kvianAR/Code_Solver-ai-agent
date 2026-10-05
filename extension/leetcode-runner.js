const TERMINAL = new Set(['completed', 'prepared', 'failed', 'blocked', 'stopped', 'interrupted']);
const ACTIVE = new Set(['discovering', 'running', 'stopping']);
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
    ['failed','blocked','interrupted'].includes(run.status))
    .sort((a,b)=>(b.finishedAt||b.startedAt||'').localeCompare(a.finishedAt||a.startedAt||''))[0]||null;
}

// Keep the old attempt in history, but free today's date key when the user
// deliberately moves the schedule after a stopped/failed automatic test.
export function archiveRetryableAutomaticRun(runs, date, archiveId) {
  const run = runs[date];
  if (!run || run.mode !== 'automatic' || ['completed','prepared'].includes(run.status) || ACTIVE.has(run.status)) return false;
  runs[archiveId] = {...run, id: archiveId};
  delete runs[date];
  return true;
}

export function shouldRetryForLaterSchedule(run, config, now = new Date()) {
  if (!run || run.mode !== 'automatic' || ['completed','prepared'].includes(run.status) || ACTIVE.has(run.status) || !run.startedAt) return false;
  const current = localClock(config.timezone, now);
  const started = localClock(config.timezone, new Date(run.startedAt));
  return started.date === current.date && started.time < config.dailyStartTime && current.time >= config.dailyStartTime;
}

export function automaticRetryDecision(run, config, now = new Date()) {
  const clock = localClock(config.timezone, now);
  if (!config.autoMode || !config.leetcode?.enabled) return {due:false, reason:'Auto Mode is off'};
  if (clock.time < config.dailyStartTime) return {due:false, reason:`Scheduled for ${config.dailyStartTime}`};
  if (!run) return {due:true, reason:'Scheduled time passed; starting now'};
  if (run.status === 'completed' || (run.tasks || []).filter(t=>t.status==='accepted').length >= config.dailyQuestionCount) return {due:false, reason:'Daily target completed'};
  if (ACTIVE.has(run.status)) return {due:false, reason:'Daily run is in progress'};
  if (run.status === 'stopped') return {due:false, reason:'Stopped manually; use Retry today to resume'};
  if (!['failed','blocked','interrupted'].includes(run.status)) return {due:false, reason:'Daily run is already scheduled'};
  if (run.status === 'interrupted') return {due:true, reason:'Interrupted run found; resuming after browser restart'};
  const nextAt=run.nextRetryAt || (run.finishedAt?new Date(new Date(run.finishedAt).getTime()+3600000).toISOString():'');
  return !nextAt || now >= new Date(nextAt)
    ? {due:true, reason:'Hourly retry is due', nextAt}
    : {due:false, reason:`Retry at ${new Intl.DateTimeFormat('en-IN',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(nextAt))}`, nextAt};
}

export function nextHourlyRetryAt(config, now = new Date()) {
  const clock=localClock(config.timezone,now);
  const minutes=clock.time.split(':').map(Number),start=config.dailyStartTime.split(':').map(Number);
  const elapsed=minutes[0]*60+minutes[1]-start[0]*60-start[1];
  const untilNext=elapsed<0?-elapsed:60-elapsed%60;
  return new Date(now.getTime()+untilNext*60000).toISOString();
}

export function localClock(timeZone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`};
}

// Daily runs retain the date key for compatibility. Each manual click has a
// separate key and cannot replace the automatic daily result.
export class LeetCodeRunner {
  constructor(io) { this.io = io; this.active = null; }

  async recover() {
    const runs = await this.io.load();
    for (const run of Object.values(runs)) {
      if (!ACTIVE.has(run.status)) continue;
      run.status = 'interrupted';
      run.feedback = 'Browser restarted during this session. Automatic work will resume after the next poll.';
      for (const task of run.tasks || []) {
        if (['solving', 'drafting', 'submitting'].includes(task.status)) task.status = 'interrupted';
      }
      await this.io.save(run);
    }
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
      run = {id: active.id, date: clock.date, mode: manual ? 'manual' : 'automatic',
        target: requestedSlug ? 1 : manual ? manualTarget : config.dailyQuestionCount, status: 'discovering',
        startedAt: this.io.now().toISOString(), username:accountUsername, retryNumber,
        tasks: manual ? [] : structuredClone(resumeTasks).filter(t=>t.status==='accepted').slice(0,config.dailyQuestionCount)};
      await this.io.save(run);
      if (active.stop) return await this.finishStopped(run);
      const accountRuns = Object.values(runs).filter(r => !accountUsername || r.username?.toLowerCase() === accountUsername.toLowerCase());
      const excludeSlugs = new Set(accountRuns.flatMap(r =>
        (r.tasks || []).map(t => t.problem?.titleSlug)).filter(Boolean));
      const acceptedTodaySlugs = new Set(accountRuns.filter(r=>r.date===clock.date).flatMap(r=>
        (r.tasks||[]).filter(t=>t.status==='accepted').map(t=>t.problem?.titleSlug)).filter(Boolean));
      const completedCount = accountRuns.reduce((n, r) =>
        n + (r.tasks || []).filter(t => t.status === 'accepted').length, 0);
      const discoverMore = async (count, preferQuestionOfTheDay) => {
        const discovered = await this.io.discover({username: accountUsername, count,
          enforceUsername: !!accountUsername,
          language: config.language, allowedDifficulties: config.allowedDifficulties,
          preferQuestionOfTheDay, requestedSlug,
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
            !(problem.selection==='QOTD'&&!acceptedTodaySlugs.has(problem.titleSlug))) continue;
          fresh.push(problem);
        }
        for (const problem of fresh.slice(0, run.target - run.tasks.length)) {
          excludeSlugs.add(problem.titleSlug);
          run.tasks.push({problem, status: 'pending', attempts: 0, feedback: ''});
        }
        if (!fresh.length) return false;
        await this.io.save(run);
        return true;
      };
      for (let pass = 0; run.tasks.length < run.target && pass < 3; pass++) {
        const found = await discoverMore(run.target - run.tasks.length,
          !requestedSlug && pass === 0 && config.preferQuestionOfTheDay);
        if (!found) break;
      }
      if (!run.tasks.length) throw Error('No eligible LeetCode question found');
      if (active.stop) return await this.finishStopped(run);
      run.status = 'running';
      await this.io.save(run);
      for (const task of run.tasks) {
        while (task.status !== 'accepted' && task.attempts < config.maxAttempts) {
          if (active.stop) return await this.finishStopped(run);
          if (accountUsername && this.io.session && (await this.io.session()).toLowerCase() !== accountUsername.toLowerCase()) throw Error('LeetCode account changed during this run. Retry with the account currently signed in.');
          task.attempts++;
          task.status = 'drafting';
          await this.io.save(run);
          if (active.stop) return await this.finishStopped(run);
          let solution;
          try {
            solution = await this.io.solve(task.problem, task.feedback, active.controller.signal);
            if (active.stop) return await this.finishStopped(run);
            task.provider = solution.provider;
            task.solution = {code: solution.code, explanation: solution.explanation, complexity: solution.complexity};
          } catch (error) {
            if (active.stop) return await this.finishStopped(run);
            task.feedback = error.message;
            task.status = 'pending';
            if (/key|quota|budget|login|session|csrf|account|contest.*is live/i.test(error.message)) {
              task.status = 'blocked';
              break;
            }
            await this.io.save(run);
            continue;
          }
          try {
            task.verification=await this.io.verify(task.problem,solution.code,active.controller.signal);
            if(!task.verification.ok){task.feedback=task.verification.feedback;task.status='pending';await this.io.save(run);continue;}
          }catch(error){if(active.stop)return await this.finishStopped(run);task.verification={ok:false,feedback:`Local syntax check unavailable: ${error.message}`};}
          if(active.stop)return await this.finishStopped(run);
          task.status='submitting';await this.io.save(run);
          try{
            const judged=await this.io.submit(task.problem,solution.code,run.username,active.controller.signal);
            task.feedback=judged.feedback||'';
            if(judged.accepted){task.status='accepted';task.submissionId=judged.submissionId||'';task.completedAt=this.io.now().toISOString();await this.io.save(run);continue;}
            task.status='pending';await this.io.save(run);
          }catch(error){
            if(active.stop)return await this.finishStopped(run);
            task.feedback=error.message;task.status='pending';
            if(/login|session|csrf|account|401|403|contest.*is live/i.test(error.message)){task.status='blocked';break;}
            await this.io.save(run);
          }
        }
        if (task.status !== 'accepted' && task.status !== 'blocked') task.status = 'failed';
        await this.io.save(run);
        if (task.status === 'blocked') break;
      }
      const readyCount = run.tasks.filter(t => t.status === 'accepted').length;
      run.status = readyCount === run.target ? 'completed' : run.tasks.some(t => t.status === 'blocked') ? 'blocked' : 'failed';
      if (run.status === 'blocked') for (const task of run.tasks) if (task.status === 'pending') {task.status='skipped';task.feedback='Earlier question was blocked; retry after fixing the provider.';}
      run.finishedAt = this.io.now().toISOString();
      if (!manual && run.status !== 'completed') run.nextRetryAt = nextHourlyRetryAt(config,this.io.now());
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
    const retry=run.mode==='automatic'&&run.status!=='completed'?' Hourly retry is scheduled.':'';
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
