import test from 'node:test';
import assert from 'node:assert/strict';
import {LeetCodeRunner, archiveRetryableAutomaticRun, automaticRetryDecision, latestArchivedAutomaticRun, nextHourlyRetryAt, shouldRetryForLaterSchedule} from '../extension/leetcode-runner.js';

const config = {timezone:'Asia/Kolkata', dailyStartTime:'10:00', autoMode:true,
  dailyQuestionCount:2, maxAttempts:8, language:'python', allowedDifficulties:['Easy'],
  preferQuestionOfTheDay:true, leetcode:{enabled:true,username:'Leetcoder071'}};
const date = '2026-09-29';
const defer = () => {let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(overrides={}, initial={}) {
  const runs=structuredClone(initial), calls={discovered:[],verified:[],submitted:[],opened:[],solved:0,notices:[]};
  let nextId=0;
  const io={
    now:()=>new Date('2026-09-29T06:00:00Z'), uuid:()=>String(++nextId),
    load:async()=>structuredClone(runs),
    save:async run=>{runs[run.id||run.date]=structuredClone(run);},
    discover:async options=>{calls.discovered.push(options);return {username:'Leetcoder071',questions:Array.from({length:options.count},(_,i)=>({titleSlug:`question-${calls.discovered.length}-${i}`,title:`Question ${i}`}))};},
    solve:async()=>{calls.solved++;return {code:'class Solution: pass',provider:'groq'};},
    verify:async(problem)=>{calls.verified.push(problem.titleSlug);return {ok:true,feedback:'Syntax check passed'};},
    submit:async problem=>{calls.submitted.push(problem.titleSlug);return {accepted:true,submissionId:`submission-${calls.submitted.length}`,feedback:'Accepted'};},
    open:async problem=>{calls.opened.push(problem.titleSlug);},
    notify:async(...args)=>calls.notices.push(args), ...overrides
  };
  return {runner:new LeetCodeRunner(io),runs,calls};
}

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
  assert.equal(automaticRetryDecision({...failed,status:'completed',tasks:[{status:'accepted'},{status:'accepted'}]},config,new Date('2026-09-29T06:06:00Z')).due,false);
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

test('temporary failures stop at eight attempts and are not retried by the minute alarm',async()=>{
  let attempts=0;const {runner,runs}=fixture({solve:async()=>{attempts++;throw Error('Temporary provider failure');}});
  runner.start(config);await runner.done;
  assert.equal(attempts,16);assert.equal(runs[date].status,'failed');
  assert.ok(runs[date].tasks.every(t=>t.attempts===8));
  runner.start(config);await runner.done;assert.equal(attempts,16);
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
    return {username:options.username,questions:[{titleSlug:'same-question',title:'Same question'},{titleSlug:'second-question',title:'Second question'}]};
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
  const {runner,runs,calls}=fixture({submit:async problem=>{
    calls.submitted.push(problem.titleSlug);submissions++;
    return submissions===1?{accepted:false,feedback:'Wrong Answer'}:{accepted:true,submissionId:String(submissions),feedback:'Accepted'};
  }});
  runner.start({...config,dailyQuestionCount:1});await runner.done;
  assert.equal(runs[date].status,'completed');assert.equal(runs[date].tasks[0].attempts,2);
  assert.equal(runs[date].tasks[0].feedback,'Accepted');
});

test('session failure blocks submission and skips remaining questions',async()=>{
  const {runner,runs}=fixture({submit:async()=>{throw Error('LeetCode session token unavailable');}});
  runner.start(config);await runner.done;
  assert.equal(runs[date].status,'blocked');
  assert.deepEqual(runs[date].tasks.map(task=>task.status),['blocked','skipped']);
});
