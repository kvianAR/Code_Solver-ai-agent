const TERMINAL = new Set(['completed', 'prepared', 'failed', 'blocked', 'stopped', 'interrupted']);
const ACTIVE = new Set(['discovering', 'running', 'stopping']);

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
      run.feedback = 'Browser restarted during this session. Start a new manual session to continue.';
      for (const task of run.tasks || []) {
        if (['solving', 'drafting', 'submitting'].includes(task.status)) task.status = 'interrupted';
      }
      await this.io.save(run);
    }
  }

  start(config, manual = false, requestedCount = 2) {
    if (this.active) return {started: false, reason: 'A session is already running', id: this.active.id};
    if (!config.leetcode?.enabled) throw Error('Enable LeetCode browser mode first');
    const manualTarget = Math.max(1, Math.min(100, Math.trunc(Number(requestedCount) || 2)));
    const clock = localClock(config.timezone, this.io.now());
    const id = manual ? `manual:${clock.date}:${this.io.uuid()}` : clock.date;
    const controller = new AbortController();
    const active = {id, stop: false, controller};
    this.active = active; // Lock before any asynchronous operation.
    this.done = this.execute(config, manual, clock, active, manualTarget).finally(() => {
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

  async execute(config, manual, clock, active, manualTarget) {
    let run;
    try {
      const runs = await this.io.load();
      if (!manual && (!config.autoMode || clock.time < config.dailyStartTime || TERMINAL.has(runs[clock.date]?.status))) return;
      run = {id: active.id, date: clock.date, mode: manual ? 'manual' : 'automatic',
        target: manual ? manualTarget : config.dailyQuestionCount, status: 'discovering',
        startedAt: this.io.now().toISOString(), tasks: []};
      await this.io.save(run);
      if (active.stop) return await this.finishStopped(run);
      const excludeSlugs = new Set(Object.values(runs).flatMap(r =>
        (r.tasks || []).map(t => t.problem?.titleSlug)).filter(Boolean));
      const completedCount = Object.values(runs).reduce((n, r) =>
        n + (r.tasks || []).filter(t => t.status === 'accepted').length, 0);
      const discoverMore = async (count, preferQuestionOfTheDay) => {
        const discovered = await this.io.discover({username: config.leetcode.username, count,
          enforceUsername: config.leetcode.enforceUsername,
          language: config.language, allowedDifficulties: config.allowedDifficulties,
          preferQuestionOfTheDay, excludeSlugs:[...excludeSlugs], completedCount});
        if (active.stop) return false;
        run.username = discovered.username;
        const fresh = discovered.questions.filter(problem => problem?.titleSlug && !excludeSlugs.has(problem.titleSlug));
        for (const problem of fresh) {
          excludeSlugs.add(problem.titleSlug);
          run.tasks.push({problem, status: 'pending', attempts: 0, feedback: ''});
        }
        if (!fresh.length) throw Error('No more untouched eligible LeetCode questions found');
        await this.io.save(run);
        return true;
      };
      await discoverMore(run.target, config.preferQuestionOfTheDay);
      if (active.stop) return await this.finishStopped(run);
      run.status = 'running';
      await this.io.save(run);
      for (const task of run.tasks) {
        while (task.status !== 'ready' && task.attempts < config.maxAttempts) {
          if (active.stop) return await this.finishStopped(run);
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
            if (/key|quota|budget|login|session|csrf|account/i.test(error.message)) {
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
          task.feedback=task.verification.feedback;
          task.status='ready';
          task.completedAt=this.io.now().toISOString();
          await this.io.save(run);
          try{await this.io.open(task.problem);}catch{}
        }
        if (task.status !== 'ready' && task.status !== 'blocked') task.status = 'failed';
        await this.io.save(run);
        if (task.status === 'blocked') break;
      }
      const readyCount = run.tasks.filter(t => t.status === 'ready').length;
      run.status = readyCount === run.target ? 'prepared' : run.tasks.some(t => t.status === 'blocked') ? 'blocked' : 'failed';
      run.finishedAt = this.io.now().toISOString();
      await this.io.save(run);
      await this.io.notify(`leetcode-${run.id}`, run.status === 'prepared' ? 'Practice drafts ready' : 'Practice preparation needs attention',
        `${run.mode === 'manual' ? 'Manual' : 'Automatic'}: ${readyCount}/${run.target} drafts ready for review on ${run.username}.`);
      return run;
    } catch (error) {
      if (active.stop && run) return await this.finishStopped(run);
      if (run) {
        run.status = 'blocked'; run.feedback = error.message;
        run.finishedAt = this.io.now().toISOString(); await this.io.save(run);
      }
      await this.io.notify('leetcode-error', 'LeetCode agent needs attention', error.message);
      return run;
    }
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
