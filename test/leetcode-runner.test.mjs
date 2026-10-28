import test from 'node:test';
import assert from 'node:assert/strict';
import {LeetCodeRunner, archiveRetryableAutomaticRun, automaticRetryDecision, latestArchivedAutomaticRun, loginPrecheckDue, nextHourlyRetryAt, shouldRetryForLaterSchedule} from '../extension/leetcode-runner.js';

const config = {timezone:'Asia/Kolkata', dailyStartTime:'10:00', autoMode:true,
  dailyQuestionCount:2, maxAttempts:8, language:'python', allowedDifficulties:['Easy'],
  preferQuestionOfTheDay:true, leetcode:{enabled:true,username:'Leetcoder071'}};
const date = '2026-09-29';
const defer = () => {let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('login is checked once before daily start and again when the run becomes due',()=>{
  const now=new Date('2026-10-20T04:25:00Z'); // 09:55 IST
  assert.equal(loginPrecheckDue(config,now),true);
  assert.equal(loginPrecheckDue(config,now,new Date('2026-10-20T04:22:00Z').getTime()),false);
  assert.equal(loginPrecheckDue(config,new Date('2026-10-20T04:30:00Z')),false);
  assert.equal(loginPrecheckDue({...config,autoMode:false},now),false);
});
function fixture(overrides={}, initial={}) {
  const runs=structuredClone(initial), calls={discovered:[],verified:[],preflighted:[],submitted:[],opened:[],solved:0,notices:[]};
  let nextId=0;
  const io={
    now:()=>new Date('2026-09-29T06:00:00Z'), uuid:()=>String(++nextId),
    load:async()=>structuredClone(runs),
    save:async run=>{runs[run.id||run.date]=structuredClone(run);},
    discover:async options=>{calls.discovered.push(options);return {username:'Leetcoder071',questions:Array.from({length:options.count},(_,i)=>({titleSlug:`question-${calls.discovered.length}-${i}`,title:`Question ${i}`,...(i===0&&options.requireQotd?{selection:'QOTD'}:{selection:'RANDOM'})}))};},
    solve:async()=>{calls.solved++;return {code:'class Solution: pass',provider:'groq'};},
    verify:async(problem)=>{calls.verified.push(problem.titleSlug);return {ok:true,feedback:'Syntax check passed'};},
    preflight:async(problem)=>{calls.preflighted.push(problem.titleSlug);return {ok:true,feedback:'LeetCode examples passed'};},
    submit:async problem=>{calls.submitted.push(problem.titleSlug);return {accepted:true,submissionId:`submission-${calls.submitted.length}`,feedback:'Accepted'};},
    open:async problem=>{calls.opened.push(problem.titleSlug);},
    notify:async(...args)=>calls.notices.push(args), ...overrides
  };
  return {runner:new LeetCodeRunner(io),runs,calls};
}

test('failed Run Code examples regenerate locally before the first judged submission',async()=>{
  let draft=0;
  const {runner,runs,calls}=fixture({
    solve:async()=>({code:`class Solution: pass # ${++draft}`,provider:'groq'}),
    preflight:async()=>({ok:draft>1,feedback:'Wrong Answer on sample'})
  });
  runner.start(config,true,1);await runner.done;
  const task=Object.values(runs)[0].tasks[0];
  assert.equal(task.status,'accepted');
  assert.equal(task.preflightRuns,2);
  assert.equal(task.preflightFailures,1);
  assert.equal(task.submissionAttempts,1);
  assert.equal(calls.submitted.length,1);
  assert.equal(task.submissionHistory[0].status,'accepted');
});

test('unavailable Run Code blocks judged submission and records the reason',async()=>{
  const {runner,runs,calls}=fixture({preflight:async()=>{throw Error('Run Code unavailable (403)');}});
  runner.start(config,false,2,'Leetcoder071');await runner.done;
  const run=Object.values(runs)[0];
  assert.equal(run.status,'blocked');
  assert.equal(run.reviewRequired,true);
  assert.match(run.tasks[0].feedback,/Run Code unavailable/);
  assert.equal(calls.submitted.length,0);
  assert.equal(run.tasks[0].problem.selection,'QOTD');
});

test('Run Code 429 schedules an hourly retry without wasting a judged submission or starting the random question',async()=>{
  const {runner,runs,calls}=fixture({preflight:async()=>{throw Error('LeetCode Run Code unavailable (429)');}});
  runner.start(config,false,2,'Leetcoder071');await runner.done;
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.status,'blocked');
  assert.equal(run.reviewRequired,undefined);
  assert.equal(run.tasks[0].problem.selection,'QOTD');
  assert.equal(run.tasks[1].status,'skipped');
  assert.equal(calls.submitted.length,0);
  assert.equal(automaticRetryDecision(run,config,new Date('2026-09-29T09:00:00Z')).due,true);
});

test('a failed QOTD prevents other automatic submissions',async()=>{
  const {runner,runs,calls}=fixture({preflight:async()=>({ok:false,feedback:'Wrong Answer'})});
  runner.start(config,false,2,'Leetcoder071');await runner.done;
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.status,'failed');
  assert.equal(run.tasks[0].attempts,8);
  assert.equal(run.tasks[1].status,'skipped');
  assert.equal(calls.submitted.length,0);
});

test('manual sessions add two questions after daily completion and retain daily result',async()=>{
  const daily={id:date,date,mode:'automatic',status:'completed',target:2,tasks:[{status:'accepted',problem:{titleSlug:'old-a'}},{status:'accepted',problem:{titleSlug:'old-b'}}]};
  const {runner,runs,calls}=fixture({}, {[date]:daily});
  runner.start({...config,dailyQuestionCount:5,autoMode:false},true);await runner.done;
  runner.start(config,true);await runner.done;
  assert.deepEqual(runs[date],daily);
  const manual=Object.values(runs).filter(r=>r.mode==='manual');
  assert.equal(manual.length,2);assert.ok(manual.every(r=>r.target===2&&r.status==='completed'));
  assert.equal(calls.submitted.length,4);
  assert.ok(calls.discovered[0].excludeSlugs.includes('old-a'));
  assert.ok(calls.discovered[1].excludeSlugs.includes('question-1-0'));
});

test('manual session accepts a custom question count up to 100',async()=>{
  const {runner,runs,calls}=fixture();
  runner.start(config,true,4);await runner.done;
  const run=Object.values(runs)[0];
  assert.equal(run.target,4);assert.equal(run.status,'completed');
  assert.equal(calls.submitted.length,4);
});

test('manual selection replaces an already attempted QOTD to reach its target',async()=>{
  const earlier={id:'manual:old',date,mode:'manual',username:'Leetcoder071',status:'completed',tasks:[{status:'accepted',problem:{titleSlug:'daily-old'}}]};
  const {runner,runs,calls}=fixture({discover:async options=>{
    calls.discovered.push(options);
    if(calls.discovered.length===1)return{username:'Leetcoder071',questions:[
      {titleSlug:'daily-old',selection:'QOTD'},
      {titleSlug:'fresh-one',selection:'ROADMAP'}]};
    return{username:'Leetcoder071',questions:[{titleSlug:'fresh-two',selection:'ROADMAP'}]};
  }},{[earlier.id]:earlier});
  runner.start(config,true,2,'Leetcoder071');await runner.done;
  const run=Object.values(runs).find(item=>item.id?.startsWith('manual:')&&item.id!==earlier.id);
  assert.equal(run.status,'completed');
  assert.deepEqual(run.tasks.map(task=>task.problem.titleSlug),['fresh-one','fresh-two']);
  assert.equal(calls.discovered.length,2);
  assert.equal(calls.discovered[1].preferQuestionOfTheDay,false);
  assert.ok(calls.discovered[0].acceptedTodaySlugs.includes('daily-old'));
});

test('attempted but unaccepted QOTD is retried for daily challenge credit',async()=>{
  const earlier={id:'manual:old',date,mode:'manual',username:'Leetcoder071',status:'failed',tasks:[{status:'failed',problem:{titleSlug:'daily-today'}}]};
  const {runner,runs,calls}=fixture({discover:async options=>{
    calls.discovered.push(options);
    return {username:'Leetcoder071',qotdNote:'QOTD selected: Daily Today.',questions:[
      {titleSlug:'daily-today',title:'Daily Today',selection:'QOTD'},
      {titleSlug:'new-question',title:'New Question',selection:'ROADMAP'}]};
  }},{[earlier.id]:earlier});
  runner.start(config,false,2,'Leetcoder071');await runner.done;
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.status,'completed');
  assert.deepEqual(run.tasks.map(t=>t.problem.titleSlug),['daily-today','new-question']);
  assert.ok(calls.discovered[0].excludeSlugs.includes('daily-today'));
  assert.deepEqual(calls.discovered[0].acceptedTodaySlugs,[]);
  assert.match(run.selectionNote,/QOTD selected/);
});

test('automatic daily run never completes with two non-QOTD questions',async()=>{
  const {runner,runs,calls}=fixture({discover:async options=>{
    calls.discovered.push(options);
    return {username:'Leetcoder071',questions:[
      {titleSlug:'random-one',title:'Random One',selection:'RANDOM'},
      {titleSlug:'random-two',title:'Random Two',selection:'RANDOM'}]};
  }});
  runner.start({...config,preferQuestionOfTheDay:false});await runner.done;
  assert.equal(runs[date].status,'blocked');
  assert.match(runs[date].feedback,/QOTD was not selected/);
  assert.equal(runs[date].nextRetryAt,'2026-09-29T06:30:00.000Z');
  assert.deepEqual(calls.submitted,[]);
  assert.equal(calls.discovered[0].requireQotd,true);
  assert.equal(calls.discovered[0].selectionMode,'random');
});

test('QOTD accepted earlier today counts once and random question fills target',async()=>{
  const earlier={id:'manual:earlier',date,mode:'manual',username:'Leetcoder071',status:'completed',tasks:[{status:'accepted',submissionId:'old-submission',problem:{titleSlug:'daily-today',selection:'CURRENT TAB'}}]};
  const {runner,runs,calls}=fixture({discover:async options=>{
    calls.discovered.push(options);
    return {username:'Leetcoder071',questions:[
      {titleSlug:'daily-today',title:'Daily Today',selection:'QOTD',alreadyAcceptedToday:true},
      {titleSlug:'random-new',title:'Random New',selection:'RANDOM'}]};
  }},{[earlier.id]:earlier});
  runner.start(config,false,2,'Leetcoder071');await runner.done;
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.status,'completed');
  assert.deepEqual(run.tasks.map(t=>t.problem.selection),['QOTD','RANDOM']);
  assert.equal(run.tasks[0].submissionId,'old-submission');
  assert.deepEqual(calls.submitted,['random-new']);
});

test('increasing the saved daily target starts the next automatic run with three questions',async()=>{
  const {runner,runs,calls}=fixture();
  runner.start({...config,dailyQuestionCount:3},false,2,'Leetcoder071');await runner.done;
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.target,3);
  assert.equal(run.status,'completed');
  assert.deepEqual(run.tasks.map(task=>task.problem.selection),['QOTD','RANDOM','RANDOM']);
  assert.equal(calls.submitted.length,3);
});

test('current-tab solve targets only that slug even if previously accepted',async()=>{
  const earlier={id:'manual:old',date,mode:'manual',username:'Leetcoder071',status:'completed',tasks:[{status:'accepted',problem:{titleSlug:'two-sum'}}]};
  const {runner,runs,calls}=fixture({discover:async options=>{
    calls.discovered.push(options);
    return{username:'Leetcoder071',questions:[{titleSlug:options.requestedSlug,selection:'CURRENT TAB'}]};
  }},{[earlier.id]:earlier});
  runner.start(config,true,1,'Leetcoder071','two-sum');await runner.done;
  const run=Object.values(runs).find(item=>item.id?.startsWith('manual:')&&item.id!==earlier.id);
  assert.equal(run.status,'completed');
  assert.equal(run.target,1);
  assert.deepEqual(calls.submitted,['two-sum']);
  assert.equal(calls.discovered[0].requestedSlug,'two-sum');
});

test('syntax-rejected draft is regenerated before review',async()=>{
  let checks=0;
  const {runner,runs,calls}=fixture({verify:async problem=>{
    calls.verified.push(problem.titleSlug);checks++;
    return checks===1?{ok:false,feedback:'Syntax error'}:{ok:true,feedback:'Syntax check passed'};
  }});
  runner.start({...config,maxAttempts:2});await runner.done;
  const run=runs[date];
  assert.equal(run.status,'completed');assert.equal(run.target,2);
  assert.equal(run.tasks.filter(t=>t.status==='accepted').length,2);
  assert.equal(run.tasks[0].attempts,2);
  assert.equal(calls.discovered.length,1);
});

test('automatic daily work is idempotent and ignores additional manual sessions',async()=>{
  const {runner,runs,calls}=fixture();
  runner.start(config);await runner.done;
  runner.start(config);await runner.done;
  assert.equal(calls.submitted.length,2);assert.equal(runs[date].status,'completed');
});

test('moving the schedule archives a stopped automatic test so today can run again',()=>{
  const stopped={id:date,date,mode:'automatic',status:'stopped',tasks:[]};
  const runs={[date]:stopped};
  assert.equal(archiveRetryableAutomaticRun(runs,date,'automatic-history:1'),true);
  assert.equal(runs[date],undefined);
  assert.equal(runs['automatic-history:1'].status,'stopped');
  const completed={[date]:{...stopped,status:'completed'}};
  assert.equal(archiveRetryableAutomaticRun(completed,date,'automatic-history:2'),false);
  assert.equal(completed[date].status,'completed');
});

test('minute poll recovers a stopped run made before a later schedule',()=>{
  const run={date,mode:'automatic',status:'stopped',startedAt:'2026-09-29T08:47:29.178Z'}; // 14:17 IST
  assert.equal(shouldRetryForLaterSchedule(run,{timezone:'Asia/Kolkata',dailyStartTime:'15:01'},new Date('2026-09-29T09:31:00Z')),true);
  assert.equal(shouldRetryForLaterSchedule({...run,status:'completed'},{timezone:'Asia/Kolkata',dailyStartTime:'15:01'},new Date('2026-09-29T09:31:00Z')),false);
  assert.equal(shouldRetryForLaterSchedule({...run,startedAt:'2026-09-29T09:32:00Z'},{timezone:'Asia/Kolkata',dailyStartTime:'15:01'},new Date('2026-09-29T09:33:00Z')),false);
});

test('hourly retry waits after failure, wakes immediately for missed first run, and stops after completion',()=>{
  assert.equal(nextHourlyRetryAt(config,new Date('2026-09-29T04:35:00Z')),'2026-09-29T05:30:00.000Z');
  assert.equal(automaticRetryDecision(null,config,new Date('2026-09-29T04:29:00Z')).due,false);
  assert.equal(automaticRetryDecision(null,config,new Date('2026-09-29T05:20:00Z')).due,true);
  const failed={status:'failed',target:2,finishedAt:'2026-09-29T05:05:00Z',nextRetryAt:'2026-09-29T06:05:00Z',tasks:[{status:'accepted'}]};
  assert.equal(automaticRetryDecision(failed,config,new Date('2026-09-29T05:59:00Z')).due,false);
  assert.equal(automaticRetryDecision(failed,config,new Date('2026-09-29T06:06:00Z')).due,true);
  assert.equal(automaticRetryDecision({...failed,status:'completed',tasks:[{status:'accepted',problem:{selection:'QOTD'}},{status:'accepted'}]},config,new Date('2026-09-29T06:06:00Z')).due,false);
  assert.equal(automaticRetryDecision({...failed,status:'interrupted'},config,new Date('2026-09-29T05:20:00Z')).due,true);
  assert.equal(automaticRetryDecision({...failed,status:'stopped'},config,new Date('2026-09-29T06:20:00Z')).due,false);
});

test('hourly retry preserves accepted question and solves only the remaining one',async()=>{
  const previous={id:date,date,mode:'automatic',username:'Leetcoder071',status:'failed',target:2,retryNumber:1,tasks:[
    {problem:{titleSlug:'already-accepted',title:'Already accepted'},status:'accepted',attempts:1},
    {problem:{titleSlug:'failed-old',title:'Failed old'},status:'failed',attempts:8,feedback:'Wrong Answer'}]};
  const runs={[date]:previous};
  assert.equal(archiveRetryableAutomaticRun(runs,date,'automatic-history:old'),true);
  assert.equal(latestArchivedAutomaticRun(runs,date,'Leetcoder071')?.tasks[0].problem.titleSlug,'already-accepted');
  const {runner,runs:saved,calls}=fixture({},runs);
  runner.start(config,false,2,'Leetcoder071','',[previous.tasks[0]],2);await runner.done;
  const completed=saved['automatic:2026-09-29:leetcoder071'];
  assert.equal(completed.status,'completed');
  assert.equal(completed.retryNumber,2);
  assert.deepEqual(completed.tasks.map(t=>t.status),['accepted','accepted']);
  assert.equal(calls.submitted.length,1);
  assert.equal(calls.discovered[0].count,1);
  assert.ok(calls.notices[0][0].startsWith('leetcode-run:'));
  assert.match(calls.notices[0][1],/2\/2 accepted/);
});

test('concurrent clicks cannot create overlapping runs',async()=>{
  const gate=defer(),entered=defer();
  const {runner,runs}=fixture({solve:async()=>{entered.resolve();await gate.promise;return {code:'solution'};}});
  assert.equal(runner.start(config,true).started,true);await entered.promise;
  assert.equal(runner.start(config,true).started,false);
  assert.equal(runner.start(config).started,false);
  gate.resolve();await runner.done;assert.equal(Object.keys(runs).length,1);
});

test('Stop during generation aborts the request and prevents review tabs',async()=>{
  const gate=defer(),entered=defer();let signal;
  const {runner,runs,calls}=fixture({solve:async(_p,_f,s)=>{signal=s;entered.resolve();await gate.promise;return {code:'solution'};}});
  runner.start(config,true);await entered.promise;
  assert.equal(runner.stop().stopped,true);assert.equal(signal.aborted,true);
  gate.resolve();await runner.done;
  assert.equal(calls.opened.length,0);assert.equal(Object.values(runs)[0].status,'stopped');
});

test('Stop retains an accepted result and skips the next question',async()=>{
  const gate=defer(),entered=defer();let solved=0;
  const {runner,runs,calls}=fixture({solve:async()=>{solved++;if(solved===2){entered.resolve();await gate.promise;}return {code:'solution'};}});
  runner.start(config);await entered.promise;runner.stop();gate.resolve();await runner.done;
  assert.equal(calls.submitted.length,1);assert.equal(runs[date].status,'stopped');
  assert.equal(runs[date].tasks[0].status,'accepted');
  runner.start(config);await runner.done;assert.equal(calls.submitted.length,1);
});

test('Stop during discovery prevents generation; a later manual click works',async()=>{
  const gate=defer(),entered=defer();
  const {runner,runs,calls}=fixture({discover:async()=>{entered.resolve();await gate.promise;return {username:'Leetcoder071',questions:[{titleSlug:'a'},{titleSlug:'b'}]};}});
  runner.start(config,true);await entered.promise;runner.stop();gate.resolve();await runner.done;
  assert.equal(calls.solved,0);assert.equal(Object.values(runs)[0].status,'stopped');
  runner.start(config,true);await runner.done;assert.equal(calls.submitted.length,2);
});

test('temporary provider failure waits for the next retry instead of burning eight calls',async()=>{
  let attempts=0;const {runner,runs}=fixture({solve:async()=>{attempts++;throw Error('Temporary provider failure');}});
  runner.start(config);await runner.done;
  assert.equal(attempts,1);assert.equal(runs[date].status,'blocked');
  assert.equal(runs[date].tasks[0].attempts,1);
  assert.equal(runs[date].tasks[0].retryKind,'network');
  assert.equal(runs[date].tasks[1].status,'skipped');
  runner.start(config);await runner.done;assert.equal(attempts,1);
});

test('a revised draft requests a different provider when one is available',async()=>{
  const avoided=[];let draft=0;
  const {runner}=fixture({
    solve:async(_problem,_feedback,_signal,avoidProvider)=>{avoided.push(avoidProvider);return{code:`draft ${++draft}`,provider:avoidProvider?'gemini':'groq'};},
    preflight:async()=>({ok:draft>1,feedback:'Wrong Answer'})
  });
  runner.start(config,true,1);await runner.done;
  assert.deepEqual(avoided,['','groq']);
});

test('worker recovery preserves completed results and marks unfinished work interrupted',async()=>{
  const {runner,runs}=fixture({}, {[date]:{date,status:'running',tasks:[{status:'accepted'},{status:'submitting'}]}});
  await runner.recover();assert.equal(runs[date].status,'interrupted');
  assert.equal(runs[date].tasks[0].status,'accepted');assert.equal(runs[date].tasks[1].status,'interrupted');
  runner.start(config);await runner.done;assert.equal(runs[date].status,'interrupted');
});

test('automatic sessions are separate for each signed-in LeetCode account',async()=>{
  const {runner,runs,calls}=fixture({discover:async options=>{
    calls.discovered.push(options);
    return {username:options.username,questions:[{titleSlug:'same-question',title:'Same question',selection:'QOTD'},{titleSlug:'second-question',title:'Second question',selection:'RANDOM'}]};
  }});
  runner.start(config,false,2,'FirstUser');await runner.done;
  runner.start(config,false,2,'SecondUser');await runner.done;
  assert.equal(runs['automatic:2026-09-29:firstuser'].status,'completed');
  assert.equal(runs['automatic:2026-09-29:seconduser'].status,'completed');
  assert.deepEqual(calls.discovered[1].excludeSlugs,[]);
  assert.equal(calls.submitted.length,4);
});

test('account switch while discovering blocks a session and leaves no pending tasks',async()=>{
  const {runner,runs}=fixture();
  runner.start(config,false,2,'DifferentUser');await runner.done;
  const run=runs['automatic:2026-09-29:differentuser'];
  assert.equal(run.status,'blocked');assert.match(run.feedback,/account changed/i);
  assert.ok(run.tasks.every(t=>t.status!=='pending'));
});

test('provider block marks later questions skipped instead of pending',async()=>{
  const {runner,runs}=fixture({solve:async()=>{throw Error('API quota or balance unavailable');}});
  runner.start(config);await runner.done;
  const run=runs[date];
  assert.equal(run.status,'blocked');
  assert.deepEqual(run.tasks.map(t=>t.status),['blocked','skipped']);
});

test('wrong answer is regenerated until LeetCode accepts it',async()=>{
  let submissions=0;
  let drafts=0;
  const feedbacks=[];
  const {runner,runs,calls}=fixture({solve:async(_problem,feedback)=>{feedbacks.push(feedback);return {code:`class Solution: pass # revision ${++drafts}`,provider:'groq'};},submit:async problem=>{
    calls.submitted.push(problem.titleSlug);submissions++;
    return submissions===1?{accepted:false,feedback:'Wrong Answer'}:{accepted:true,submissionId:String(submissions),feedback:'Accepted'};
  }});
  runner.start({...config,dailyQuestionCount:1});await runner.done;
  assert.equal(runs[date].status,'completed');assert.equal(runs[date].tasks[0].attempts,2);
  assert.equal(runs[date].tasks[0].feedback,'Accepted');
  assert.match(feedbacks[1],/Previously rejected code/);
});

test('only two judged submissions per question are allowed across hourly retries',async()=>{
  let drafts=0;
  const first=fixture({discover:async()=>({username:'Leetcoder071',questions:[{titleSlug:'daily-question',title:'Daily question',selection:'QOTD'}]}),
    solve:async()=>({code:`revision ${++drafts}`,provider:'groq'}),
    submit:async problem=>{first.calls.submitted.push(problem.titleSlug);return {accepted:false,feedback:'Wrong Answer'};}});
  first.runner.start({...config,dailyQuestionCount:1},false,1,'Leetcoder071');await first.runner.done;
  const failed=first.runs[`automatic:${date}:leetcoder071`];
  assert.equal(first.calls.submitted.length,2);
  assert.equal(failed.tasks[0].submissionAttempts,2);
  assert.equal(failed.reviewRequired,true);
  assert.equal(automaticRetryDecision(failed,config,new Date('2026-09-29T09:00:00Z')).due,false);
  const archiveId='automatic-history:2026-09-29:old';
  first.runs[archiveId]={...failed,id:archiveId};
  delete first.runs[failed.id];
  first.runner.start({...config,dailyQuestionCount:1},false,1,'Leetcoder071');await first.runner.done;
  assert.equal(first.calls.submitted.length,2);
});

test('archived copies of one judged submission do not consume two daily slots',async()=>{
  const oldTask={problem:{titleSlug:'daily-question',title:'Daily question',selection:'QOTD'},status:'failed',attempts:1,submissionAttempts:1,
    submittedCodeFingerprints:['old-code'],submissionHistory:[{at:'2026-09-29T05:00:00Z',fingerprint:'old-code',submissionId:'judge-1',status:'rejected'}]};
  const archived={date,mode:'automatic',username:'Leetcoder071',status:'failed',tasks:[oldTask]};
  const initial={'automatic-history:one':structuredClone(archived),'automatic-history:two':structuredClone(archived)};
  let drafts=0;
  const {runner,runs,calls}=fixture({
    discover:async()=>({username:'Leetcoder071',questions:[{titleSlug:'daily-question',title:'Daily question',selection:'QOTD'}]}),
    solve:async()=>({code:`revision ${++drafts}`,provider:'groq'})
  },initial);
  runner.start({...config,dailyQuestionCount:1},false,1,'Leetcoder071');await runner.done;
  assert.equal(calls.submitted.length,1);
  assert.equal(runs[`automatic:${date}:leetcoder071`].status,'completed');
});

test('identical regenerated code is not submitted twice',async()=>{
  const {runner,runs,calls}=fixture({submit:async problem=>{calls.submitted.push(problem.titleSlug);return {accepted:false,feedback:'Wrong Answer'};}});
  runner.start({...config,dailyQuestionCount:1},false,1,'Leetcoder071');await runner.done;
  assert.equal(calls.submitted.length,1);
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.reviewRequired,true);
  assert.equal(run.tasks[0].submissionAttempts,1);
});

test('uncertain submission result pauses instead of resubmitting',async()=>{
  const {runner,runs,calls}=fixture({submit:async problem=>{calls.submitted.push(problem.titleSlug);throw Error('LeetCode submission failed (429)');}});
  runner.start({...config,dailyQuestionCount:1},false,1,'Leetcoder071');await runner.done;
  assert.equal(calls.submitted.length,1);
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.status,'blocked');
  assert.equal(run.reviewRequired,true);
  assert.equal(automaticRetryDecision(run,config,new Date('2026-09-29T09:00:00Z')).due,false);
});

test('unavailable local check does not send unverified code to LeetCode',async()=>{
  const {runner,runs,calls}=fixture({verify:async()=>{throw Error('checker offline');}});
  runner.start({...config,dailyQuestionCount:1},false,1,'Leetcoder071');await runner.done;
  assert.equal(calls.submitted.length,0);
  const run=runs[`automatic:${date}:leetcoder071`];
  assert.equal(run.status,'blocked');
  assert.equal(run.reviewRequired,true);
});

test('session failure blocks submission and skips remaining questions',async()=>{
  const {runner,runs}=fixture({submit:async()=>{throw Error('LeetCode session token unavailable');}});
  runner.start(config);await runner.done;
  assert.equal(runs[date].status,'blocked');
  assert.deepEqual(runs[date].tasks.map(task=>task.status),['blocked','skipped']);
});

test('manual review mode cannot downgrade any automatic allotted question to a draft',async()=>{
  const {runner,runs,calls}=fixture();
  runner.start({...config,reviewBeforeSubmit:true},false,2,'Leetcoder071');await runner.done;
  const run=Object.values(runs)[0];
  assert.equal(run.status,'completed');assert.equal(run.tasks.length,2);
  assert.equal(run.tasks[0].status,'accepted');assert.equal(run.tasks[0].problem.selection,'QOTD');assert.equal(run.tasks[1].status,'accepted');
  assert.equal(calls.submitted.length,2);assert.equal(run.nextRetryAt,undefined);
  assert.equal(automaticRetryDecision(run,config).due,false);
});

test('retry interval follows the selected schedule rather than a fixed hour',()=>{
  const chosen={...config,automaticRetryMinutes:30};
  assert.equal(nextHourlyRetryAt(chosen,new Date('2026-09-29T04:41:00Z')),'2026-09-29T05:00:00.000Z');
});

test('restart recovers a saved judged result without generating or submitting again',async()=>{
  const initial={saved:{id:'saved',mode:'automatic',username:'Leetcoder071',status:'running',target:1,
    tasks:[{status:'submitting',submissionId:'12345',problem:{titleSlug:'daily',selection:'QOTD'},submissionHistory:[{status:'unknown'}]}]}};
  const {runner,runs,calls}=fixture({result:async(id,user)=>{assert.equal(id,'12345');assert.equal(user,'Leetcoder071');return {accepted:true,feedback:'Accepted'};}},initial);
  await runner.recover();assert.equal(runs.saved.status,'completed');
  assert.equal(runs.saved.tasks[0].submissionHistory[0].status,'accepted');
  assert.equal(calls.solved,0);assert.equal(calls.submitted.length,0);
});

test('restart blocks an uncertain submission without an id instead of resubmitting',async()=>{
  const {runner,runs}=fixture({result:async()=>{throw Error('must not request an unknown id');}},
    {saved:{id:'saved',status:'running',tasks:[{status:'submitting',problem:{titleSlug:'daily'}}]}});
  await runner.recover();assert.equal(runs.saved.status,'blocked');assert.equal(runs.saved.reviewRequired,true);
});

test('submission id is persisted before the result polling finishes',async()=>{
  const entered=defer(),finish=defer();
  const {runner,runs}=fixture({submit:async()=>{entered.resolve();await finish.promise;return {accepted:true,submissionId:'123'};}});
  runner.start(config,true,1,'Leetcoder071');await entered.promise;
  await runner.recordSubmission('question-1-0','123','Leetcoder071');
  assert.equal(Object.values(runs)[0].tasks[0].submissionId,'123');
  assert.equal(Object.values(runs)[0].tasks[0].submissionHistory[0].submissionId,'123');
  finish.resolve();await runner.done;
});

test('automatic review drafts cannot block the full daily allotment',()=>{
  const run={id:date,mode:'automatic',date,status:'review',startedAt:'2026-09-29T04:30:00Z',tasks:[{status:'accepted',problem:{selection:'QOTD'}}]};
  const runs={[date]:run};
  assert.equal(archiveRetryableAutomaticRun(runs,date,'archive'),true);
  assert.equal(shouldRetryForLaterSchedule(run,config,new Date('2026-09-29T06:00:00Z')),false);
});

test('retry times land on the scheduled minute without second drift',()=>{
  assert.equal(nextHourlyRetryAt(config,new Date('2026-09-29T04:41:47.123Z')),'2026-09-29T05:30:00.000Z');
});

test('additional generated cases go to the official preflight before any judged submission',async()=>{
  let extra;
  const {runner,calls}=fixture({solve:async()=>({code:'class Solution: pass',provider:'groq',testCases:[{input:'[1]\n2',reason:'boundary'}]}),preflight:async(problem)=>{extra=problem.additionalTestcases;return {ok:true};}});
  runner.start({...config,additionalChecks:true},true,1,'Leetcoder071');await runner.done;
  assert.equal(extra[0].input,'[1]\n2');assert.equal(calls.submitted.length,1);
});

test('a QOTD-only automatic target completes even when draft review is enabled',async()=>{
  const {runner,runs,calls}=fixture();
  runner.start({...config,dailyQuestionCount:1,reviewBeforeSubmit:true},false,1,'Leetcoder071');await runner.done;
  const run=Object.values(runs)[0];assert.equal(run.status,'completed');assert.equal(run.tasks[0].status,'accepted');assert.equal(calls.submitted.length,1);
});

test('an old automatic QOTD review draft is resumable rather than treated as finished',()=>{
  const run={id:date,mode:'automatic',date,status:'review',tasks:[{status:'review',problem:{selection:'QOTD'}}]};
  assert.equal(automaticRetryDecision(run,config,new Date('2026-09-29T06:00:00Z')).due,true);
  assert.equal(archiveRetryableAutomaticRun({[date]:run},date,'archive'),true);
});

test('automatic QOTD still respects judged limits when review is enabled',async()=>{
  let draft=0;const {runner,runs,calls}=fixture({solve:async()=>({code:'draft '+(++draft),provider:'groq'}),submit:async problem=>{calls.submitted.push(problem.titleSlug);return {accepted:false,submissionId:String(draft),feedback:'Wrong Answer'};}});
  runner.start({...config,reviewBeforeSubmit:true},false,2,'Leetcoder071');await runner.done;
  const run=Object.values(runs)[0];assert.equal(calls.submitted.length,2);assert.equal(run.reviewRequired,true);assert.notEqual(run.status,'completed');
});

test('raising a completed daily allotment resumes only the additional question today',async()=>{
  const first=fixture();first.runner.start(config,false,2,'Leetcoder071');await first.runner.done;
  const run=Object.values(first.runs)[0],larger={...config,dailyQuestionCount:3};
  assert.equal(automaticRetryDecision(run,larger,new Date('2026-09-29T06:00:00Z')).due,true);
  assert.equal(archiveRetryableAutomaticRun(first.runs,run.id,'automatic-history:allotment',3),true);
  const next=fixture({discover:async options=>{assert.equal(options.requireQotd,false);return {username:'Leetcoder071',questions:[{titleSlug:'additional-question',title:'Additional question',selection:'RANDOM'}]};}},first.runs);next.runner.start(larger,false,3,'Leetcoder071','',run.tasks,2);await next.runner.done;
  const result=Object.values(next.runs).find(r=>r.id===run.id);assert.equal(result.status,'completed');assert.equal(result.tasks.filter(t=>t.status==='accepted').length,3);assert.equal(next.calls.submitted.length,1);
});

test('manual review still produces a draft without a judged submission',async()=>{
  const {runner,runs,calls}=fixture();runner.start({...config,reviewBeforeSubmit:true},true,1,'Leetcoder071');await runner.done;
  assert.equal(Object.values(runs)[0].status,'review');assert.equal(calls.submitted.length,0);
});
