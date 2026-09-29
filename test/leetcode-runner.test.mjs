import test from 'node:test';
import assert from 'node:assert/strict';
import {LeetCodeRunner, archiveRetryableAutomaticRun, shouldRetryForLaterSchedule} from '../extension/leetcode-runner.js';

const config = {timezone:'Asia/Kolkata', dailyStartTime:'10:00', autoMode:true,
  dailyQuestionCount:2, maxAttempts:8, language:'python', allowedDifficulties:['Easy'],
  preferQuestionOfTheDay:true, leetcode:{enabled:true,username:'Leetcoder071'}};
const date = '2026-09-29';
const defer = () => {let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(overrides={}, initial={}) {
  const runs=structuredClone(initial), calls={discovered:[],verified:[],opened:[],solved:0,notices:[]};
  let nextId=0;
  const io={
    now:()=>new Date('2026-09-29T06:00:00Z'), uuid:()=>String(++nextId),
    load:async()=>structuredClone(runs),
    save:async run=>{runs[run.id||run.date]=structuredClone(run);},
    discover:async options=>{calls.discovered.push(options);return {username:'Leetcoder071',questions:Array.from({length:options.count},(_,i)=>({titleSlug:`question-${calls.discovered.length}-${i}`,title:`Question ${i}`}))};},
    solve:async()=>{calls.solved++;return {code:'class Solution: pass',provider:'groq'};},
    verify:async(problem)=>{calls.verified.push(problem.titleSlug);return {ok:true,feedback:'Syntax check passed'};},
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
  assert.equal(manual.length,2);assert.ok(manual.every(r=>r.target===2&&r.status==='prepared'));
  assert.equal(calls.opened.length,4);
  assert.ok(calls.discovered[0].excludeSlugs.includes('old-a'));
  assert.ok(calls.discovered[1].excludeSlugs.includes('question-1-0'));
});

test('manual session accepts a custom question count up to 100',async()=>{
  const {runner,runs,calls}=fixture();
  runner.start(config,true,4);await runner.done;
  const run=Object.values(runs)[0];
  assert.equal(run.target,4);assert.equal(run.status,'prepared');
  assert.equal(calls.opened.length,4);
});

test('syntax-rejected draft is regenerated before review',async()=>{
  let checks=0;
  const {runner,runs,calls}=fixture({verify:async problem=>{
    calls.verified.push(problem.titleSlug);checks++;
    return checks===1?{ok:false,feedback:'Syntax error'}:{ok:true,feedback:'Syntax check passed'};
  }});
  runner.start({...config,maxAttempts:2});await runner.done;
  const run=runs[date];
  assert.equal(run.status,'prepared');assert.equal(run.target,2);
  assert.equal(run.tasks.filter(t=>t.status==='ready').length,2);
  assert.equal(run.tasks[0].attempts,2);
  assert.equal(calls.discovered.length,1);
});

test('automatic daily work is idempotent and ignores additional manual sessions',async()=>{
  const {runner,runs,calls}=fixture();
  runner.start(config);await runner.done;
  runner.start(config);await runner.done;
  assert.equal(calls.opened.length,2);assert.equal(runs[date].status,'prepared');
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

test('Stop retains an already-prepared draft and skips the next question',async()=>{
  const gate=defer(),entered=defer();let opened=0;
  const {runner,runs}=fixture({open:async()=>{opened++;entered.resolve();await gate.promise;}});
  runner.start(config);await entered.promise;runner.stop();gate.resolve();await runner.done;
  assert.equal(opened,1);assert.equal(runs[date].status,'stopped');
  assert.equal(runs[date].tasks[0].status,'ready');
  runner.start(config);await runner.done;assert.equal(opened,1);
});

test('Stop during discovery prevents generation; a later manual click works',async()=>{
  const gate=defer(),entered=defer();
  const {runner,runs,calls}=fixture({discover:async()=>{entered.resolve();await gate.promise;return {username:'Leetcoder071',questions:[{titleSlug:'a'},{titleSlug:'b'}]};}});
  runner.start(config,true);await entered.promise;runner.stop();gate.resolve();await runner.done;
  assert.equal(calls.solved,0);assert.equal(Object.values(runs)[0].status,'stopped');
  runner.start(config,true);await runner.done;assert.equal(calls.opened.length,2);
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
  assert.equal(runs['automatic:2026-09-29:firstuser'].status,'prepared');
  assert.equal(runs['automatic:2026-09-29:seconduser'].status,'prepared');
  assert.deepEqual(calls.discovered[1].excludeSlugs,[]);
  assert.equal(calls.opened.length,4);
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
