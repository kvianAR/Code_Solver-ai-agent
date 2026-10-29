import test from 'node:test';
import assert from 'node:assert/strict';
import {LeetCodeRunner,automaticRetryDecision,archiveRetryableAutomaticRun,hasAcceptedQotd,qotdSatisfied} from '../extension/leetcode-runner.js';
import {dailyQotdDisposition,deadlineNotice} from '../extension/daily-recovery.js';
const date='2026-10-28',username='Student',config={autoMode:true,leetcode:{enabled:true},timezone:'Asia/Kolkata',dailyStartTime:'10:00',dailyQuestionCount:2,maxAttempts:8,language:'python',allowedDifficulties:['Easy','Medium','Hard']};
const q=(titleSlug,selection='RANDOM',difficulty='Easy')=>({titleSlug,title:titleSlug,selection,difficulty,starterCode:'class Solution: pass'});
function fixture({fail=()=>false,preflightFail=()=>false,already=false,repeated=false,initial={},network=false,required=true}={}){
 const runs=structuredClone(initial),calls={solve:[],submit:[],discover:[],notices:[]};let id=0,replacement=0;
 const io={now:()=>new Date('2026-10-28T06:00:00Z'),uuid:()=>String(++id),load:async()=>structuredClone(runs),save:async run=>{runs[run.id]=structuredClone(run);},session:async()=>username,
  discover:async options=>{calls.discover.push(options);if(options.allowedDifficulties.length===1&&options.allowedDifficulties[0]==='Easy')return {username,questions:[q('easy-replacement-'+(++replacement))]};return {username,qotdAlreadyAccepted:already||!required?'old-qotd':'',questions:already?[q('new-one'),q('new-two')]:[q('qotd',required?'QOTD':options.retrySlugs?.includes('qotd')?'RETRY':'RANDOM','Medium'),q('second')]};},
  solve:async(problem,_feedback,_signal,_provider,_session,context)=>{calls.solve.push({slug:problem.titleSlug,plan:context.attemptPlan});return {code:problem.titleSlug+'-'+(repeated?1:context.attemptPlan.number),approach:repeated?'same-algorithm':'algorithm-'+context.attemptPlan.number,provider:'groq'};},
  verify:async()=>({ok:true}),preflight:async(problem)=>{if(network)throw Error('Run Code unavailable (429)');return {ok:!preflightFail(problem.titleSlug),feedback:'Wrong Answer'};},
  submit:async problem=>{calls.submit.push(problem.titleSlug);return {accepted:!fail(problem.titleSlug),submissionId:String(calls.submit.length),feedback:fail(problem.titleSlug)?'Wrong Answer':'Accepted'};},
  notify:async(...args)=>calls.notices.push(args)};
 return {runner:new LeetCodeRunner(io),runs,calls};
}
test('three different known rejections skip QOTD and an Easy replacement completes the full allotted count',async()=>{
 const f=fixture({fail:slug=>slug==='qotd',required:false});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.tasks.filter(t=>t.status==='accepted').length,2);assert.equal(run.tasks.find(t=>t.problem.titleSlug==='qotd').status,'skipped');
 assert.equal(run.skipCount,1);assert.equal(run.qotdDisposition,'already-accepted');assert.equal(hasAcceptedQotd(run),false);assert.equal(qotdSatisfied(run),true);
 assert.deepEqual(f.calls.solve.filter(r=>r.slug==='qotd').map(r=>r.plan.number),[1,2,3]);assert.equal(f.calls.submit.filter(slug=>slug==='qotd').length,3);
 const replacement=f.calls.discover.at(-1);assert.deepEqual(replacement.allowedDifficulties,['Easy']);assert.equal(replacement.selectionMode,'random');assert.equal(replacement.requireQotd,false);
 assert.equal(dailyQotdDisposition(f.runs,date,username),'already-accepted');assert.equal(deadlineNotice(config,f.runs,username,{},new Date('2026-10-28T18:20:00Z')),null);
});
test('already-accepted QOTD is excluded and the configured number of other questions must be newly accepted',async()=>{
 const f=fixture({already:true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.qotdDisposition,'already-accepted');assert.deepEqual(f.calls.submit,['new-one','new-two']);assert.equal(run.tasks.length,2);assert.ok(!run.tasks.some(t=>t.problem.titleSlug==='old-qotd'));
});
test('three failed test approaches count as a skip but never send failing drafts to the judge',async()=>{
 const f=fixture({preflightFail:slug=>slug==='qotd',required:false});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.skipCount,1);assert.equal(f.calls.submit.includes('qotd'),false);assert.equal(run.tasks[0].approachHistory.filter(a=>a.status==='test-failed').length,3);
});
test('the third skipped question stops the daily run, notifies, and cannot be reset by retrying or archives',async()=>{
 const f=fixture({fail:()=>true,required:false});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.skipCount,3);assert.equal(run.reviewReason,'daily-skip-limit');assert.equal(run.status,'blocked');assert.equal(run.tasks.filter(t=>t.status==='skipped').length,3);assert.equal(f.calls.submit.length,9);assert.equal(f.calls.discover.length,3);
 assert.match(f.calls.notices.at(-1).join(' '),/Three daily skips reached/);assert.equal(automaticRetryDecision(run,config,new Date('2026-10-28T17:00:00Z')).due,false);
 assert.equal(archiveRetryableAutomaticRun(f.runs,run.id,'automatic-history:cap'),true);
 const retry=fixture({initial:f.runs});retry.runner.start(config,false,2,username);await retry.runner.done;assert.equal(retry.calls.solve.length,0);assert.equal(retry.calls.discover.length,0);assert.equal(retry.calls.notices.length,1);
 const other=fixture({initial:f.runs});other.runner.io.session=async()=> 'Other';other.runner.io.discover=async()=>({username:'Other',qotdAlreadyAccepted:'old',questions:[q('other-one'),q('other-two')]});other.runner.start(config,false,2,'Other');await other.runner.done;assert.equal(Object.values(other.runs).find(r=>r.username==='Other').status,'completed');
});
test('429 schedules a timed retry, not an approach failure or skip, and untried work stays queued',async()=>{
 const f=fixture({network:true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'retrying');assert.deepEqual(run.tasks.map(t=>t.status),['retrying','queued']);assert.equal(run.skipCount,0);assert.equal(f.calls.submit.length,0);assert.equal(run.tasks[0].approachHistory[0].status,'prepared');assert.equal(run.nextRetryAt,'2026-10-28T06:01:00.000Z');
});
test('repeated algorithms trigger bounded preparation replacement without claiming three different algorithms',async()=>{
 const f=fixture({fail:()=>true,repeated:true,required:false});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'blocked');assert.equal(run.reviewReason,'daily-skip-limit');assert.equal(run.skipCount,3);assert.equal(f.calls.submit.length,3);
 for(const task of run.tasks.filter(t=>t.status==='skipped')){assert.equal(task.skipReason,'draft-preparation-failed');assert.equal(task.approachHistory.length,1);assert.equal(task.preparationFailures,3);}
});
test('failed approach history survives a service outage and resumption without resetting the three-approach cap',async()=>{
 const f=fixture({fail:slug=>slug==='qotd',required:false});let checks=0;f.runner.io.preflight=async(problem)=>{if(problem.titleSlug==='qotd'&&++checks===2)throw Error('Run Code unavailable (429)');return {ok:true};};
 f.runner.start(config,false,2,username);await f.runner.done;const old=Object.values(f.runs)[0];assert.equal(old.status,'retrying');assert.equal(old.tasks[0].submissionAttempts,1);
 archiveRetryableAutomaticRun(f.runs,old.id,'automatic-history:outage');const retry=fixture({initial:f.runs,fail:slug=>slug==='qotd',required:false});
 retry.runner.start(config,false,2,username);await retry.runner.done;const run=Object.values(retry.runs).find(r=>r.id===old.id);
 assert.equal(run.status,'completed',JSON.stringify({run,calls:retry.calls}));assert.equal(run.skipCount,1);assert.equal(retry.calls.submit.filter(s=>s==='qotd').length,2);assert.equal(run.tasks[0].approachHistory.filter(a=>a.status==='rejected').length,3);
});
test('stopping an in-flight result does not prevent reconciliation or permit an unsafe replacement',async()=>{
 const initial={old:{id:'old',date,mode:'automatic',username,status:'stopped',target:2,tasks:[{status:'stopped',problem:q('qotd','QOTD'),submissionId:'123',submissionHistory:[{status:'unknown',submissionId:'123'}]}]}};
 const f=fixture({initial});let results=0;f.runner.io.result=async()=>{results++;return {accepted:true,feedback:'Accepted'};};await f.runner.recover(true,username);
 assert.equal(results,1);assert.equal(f.runs.old.status,'stopped');assert.equal(f.runs.old.tasks[0].status,'accepted');assert.equal(f.calls.solve.length,0);assert.equal(f.calls.submit.length,0);
});

test('Stop preserves skipped-question evidence and the daily cap',async()=>{
 const f=fixture();const run={id:'stopping',date,mode:'automatic',username,status:'running',tasks:[{status:'skipped',skipReason:'three-approaches-failed',problem:q('failed')},{status:'drafting',problem:q('remaining')}]};
 await f.runner.finishStopped(run);assert.equal(f.runs.stopping.tasks[0].status,'skipped');assert.equal(f.runs.stopping.tasks[1].status,'stopped');
});

test('a server retry deadline drives automatic recovery and keeps a cached draft and checkpoint',async()=>{
 const f=fixture();f.runner.io.preflight=async()=>{throw Object.assign(Error('Run Code result unavailable (429)'),{kind:'rate',retryAt:'2026-10-28T06:03:00.000Z',checkpoint:{runId:'pending-test'}});};
 f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];assert.equal(run.status,'retrying');assert.equal(run.nextRetryAt,'2026-10-28T06:03:00.000Z');assert.equal(run.tasks[0].preflightCheckpoint.runId,'pending-test');
 assert.equal(automaticRetryDecision(run,config,new Date('2026-10-28T06:02:59Z')).due,false);assert.equal(automaticRetryDecision(run,config,new Date('2026-10-28T06:03:00Z')).due,true);
 archiveRetryableAutomaticRun(f.runs,run.id,'automatic-history:rate');const retry=fixture({initial:f.runs});const checkpoints=[];
 retry.runner.io.preflight=async(problem)=>{checkpoints.push(problem.preflightCheckpoint);return {ok:true};};retry.runner.start(config,false,2,username);await retry.runner.done;
 assert.equal(checkpoints[0]?.runId,'pending-test');assert.equal(Object.values(retry.runs).find(r=>r.id===run.id).tasks[0].reusedDrafts,1);
 assert.equal(retry.calls.solve.some(r=>r.slug==='qotd'),false);assert.equal(Object.values(retry.runs).find(r=>r.id===run.id).status,'completed');
});
test('an explicitly rejected HTTP 429 submit request does not consume a judged slot or create an unknown result',async()=>{
 const f=fixture();f.runner.io.submit=async()=>{throw Object.assign(Error('LeetCode submission failed (429)'),{submissionSent:false,kind:'rate',retryAt:'2026-10-28T06:02:00Z'});};
 f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0],task=run.tasks[0];
 assert.equal(run.status,'retrying');assert.equal(run.reviewRequired,undefined);assert.equal(task.submissionAttempts,0);assert.equal(task.submissionHistory.length,0);assert.equal(task.submittedCodeFingerprints.length,0);assert.equal(task.submissionTransportFailures,1);
 assert.equal(run.nextRetryAt,'2026-10-28T06:02:00.000Z');
});

test('typed service failures never consume draft preparation or skip allowances',async()=>{
 for(const kind of ['temporary','rate','key','quota','request']){
  const f=fixture();f.runner.io.solve=async()=>{throw Object.assign(Error('Provider returned invalid JSON'),{kind,retryAt:'2026-10-28T06:07:00.000Z'});};
  f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
  assert.equal(run.skipCount,0,kind);assert.equal(run.tasks[0].preparationFailures||0,0,kind);
  assert.equal(run.tasks[0].status,['temporary','rate'].includes(kind)?'retrying':'blocked',kind);
  assert.equal(run.tasks[1].status,'queued',kind);assert.equal(f.calls.submit.length,0,kind);
  if(['temporary','rate'].includes(kind))assert.equal(run.nextRetryAt,'2026-10-28T06:07:00.000Z');
 }
});
test('typed unusable draft errors count as preparation failures despite misleading message words',async()=>{
 const f=fixture({required:false});f.runner.io.solve=async(problem)=>{
  if(problem.titleSlug==='qotd')throw Object.assign(Error('Model returned network connection example instead of code'),{kind:'output'});
  return {code:'class Solution: pass',approach:'linear scan',provider:'gemini'};
 };
 f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.skipCount,1);assert.equal(run.tasks[0].preparationFailures,3);
 assert.equal(run.tasks[0].skipReason,'draft-preparation-failed');
});


test('required QOTD never skips or gets replaced after three failed approaches',async()=>{
 const f=fixture({fail:slug=>slug==='qotd'});f.runner.start(config,false,2,username);await f.runner.done;
 const run=Object.values(f.runs)[0];assert.equal(run.status,'blocked');assert.equal(run.reviewReason,'qotd-needs-repair');
 assert.equal(run.skipCount,0);assert.equal(run.tasks[0].status,'blocked');assert.equal(run.tasks[0].skipReason,undefined);
 assert.equal(qotdSatisfied(run),false);assert.equal(f.calls.discover.length,1);assert.equal(f.calls.submit.length,3);
 assert.equal(run.tasks[1].status,'queued');assert.match(run.tasks[0].feedback,/will not be skipped/);
});
test('legacy skipped QOTD is not a completion exemption',()=>{
 for(const disposition of ['three-approaches-failed','draft-preparation-failed'])assert.equal(qotdSatisfied({qotdDisposition:disposition,tasks:[]}),false);
});
