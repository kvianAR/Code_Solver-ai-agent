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
test('ordinary questions stay pending after three known rejections without replacement',async()=>{
 const f=fixture({fail:slug=>slug==='qotd',required:false});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'blocked');assert.equal(run.reviewReason,'question-needs-repair');assert.equal(run.skipCount,0);
 assert.equal(run.tasks[0].skipReason,undefined);assert.equal(run.tasks[1].status,'queued');assert.equal(f.calls.discover.length,1);
 assert.deepEqual(f.calls.solve.map(r=>r.plan.number),[1,2,3]);assert.equal(f.calls.submit.length,3);
});

test('already-accepted QOTD is excluded and the configured number of other questions must be newly accepted',async()=>{
 const f=fixture({already:true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.qotdDisposition,'already-accepted');assert.deepEqual(f.calls.submit,['new-one','new-two']);assert.equal(run.tasks.length,2);assert.ok(!run.tasks.some(t=>t.problem.titleSlug==='old-qotd'));
});
test('three failed preflight approaches retain the question without sending any judged submission',async()=>{
 const f=fixture({preflightFail:slug=>slug==='qotd',required:false});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'blocked');assert.equal(run.skipCount,0);assert.equal(f.calls.submit.length,0);
 assert.equal(run.tasks[0].approachHistory.filter(a=>a.status==='test-failed').length,3);assert.equal(f.calls.discover.length,1);
});

test('historical daily skip evidence remains capped without creating new skips',async()=>{
 const initial={old:{id:'old',date,mode:'automatic',username,status:'blocked',tasks:[1,2,3].map(i=>({status:'skipped',skipReason:'three-approaches-failed',problem:q('old-'+i)}))}};
 const f=fixture({initial});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs).find(r=>r.id!=='old');
 assert.equal(run.reviewReason,'daily-skip-limit');assert.equal(run.skipCount,3);assert.equal(f.calls.solve.length,0);assert.equal(f.calls.discover.length,0);
});

test('429 schedules a timed retry, not an approach failure or skip, and untried work stays queued',async()=>{
 const f=fixture({network:true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'retrying');assert.deepEqual(run.tasks.map(t=>t.status),['retrying','queued']);assert.equal(run.skipCount,0);assert.equal(f.calls.submit.length,0);assert.equal(run.tasks[0].approachHistory[0].status,'prepared');assert.equal(run.nextRetryAt,'2026-10-28T06:01:00.000Z');
});
test('repeated algorithms keep the same question pending after bounded preparation',async()=>{
 const f=fixture({fail:()=>true,repeated:true,required:false});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.reviewReason,'question-needs-repair');assert.equal(run.skipCount,0);assert.equal(f.calls.submit.length,1);
 assert.equal(run.tasks[0].preparationFailures,3);assert.equal(run.tasks[0].approachHistory.length,1);assert.equal(f.calls.discover.length,1);
});

test('failed approach history survives a service outage and resumption without resetting the three-approach cap',async()=>{
 const f=fixture({fail:slug=>slug==='qotd',required:false});let checks=0;f.runner.io.preflight=async(problem)=>{if(problem.titleSlug==='qotd'&&++checks===2)throw Error('Run Code unavailable (429)');return {ok:true};};
 f.runner.start(config,false,2,username);await f.runner.done;const old=Object.values(f.runs)[0];assert.equal(old.status,'retrying');assert.equal(old.tasks[0].submissionAttempts,1);
 archiveRetryableAutomaticRun(f.runs,old.id,'automatic-history:outage');const retry=fixture({initial:f.runs,fail:slug=>slug==='qotd',required:false});
 retry.runner.start(config,false,2,username);await retry.runner.done;const run=Object.values(retry.runs).find(r=>r.id===old.id);
 assert.equal(run.status,'blocked',JSON.stringify({run,calls:retry.calls}));assert.equal(run.skipCount,0);assert.equal(retry.calls.submit.filter(s=>s==='qotd').length,2);assert.equal(run.tasks[0].approachHistory.filter(a=>a.status==='rejected').length,3);
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
 assert.equal(run.status,'blocked');assert.equal(run.skipCount,0);assert.equal(run.tasks[0].preparationFailures,3);
 assert.equal(run.tasks[0].skipReason,undefined);
});


test('required QOTD never skips or gets replaced after three failed approaches',async()=>{
 const f=fixture({fail:slug=>slug==='qotd'});f.runner.start(config,false,2,username);await f.runner.done;
 const run=Object.values(f.runs)[0];assert.equal(run.status,'blocked');assert.equal(run.reviewReason,'qotd-needs-repair');
 assert.equal(run.skipCount,0);assert.equal(run.tasks[0].status,'blocked');assert.equal(run.tasks[0].skipReason,undefined);
 assert.equal(qotdSatisfied(run),false);assert.equal(f.calls.discover.length,1);assert.equal(f.calls.submit.length,3);
 assert.equal(run.tasks[1].status,'queued');assert.match(run.tasks[0].feedback,/Question remains pending/);
});
test('legacy skipped QOTD is not a completion exemption',()=>{
 for(const disposition of ['three-approaches-failed','draft-preparation-failed'])assert.equal(qotdSatisfied({qotdDisposition:disposition,tasks:[]}),false);
});

test('larger output budget permits one explicit QOTD preparation repair and retains total failure history',async()=>{
 const {repairQotdPreparation}=await import('../extension/leetcode-runner.js');
 const run={reviewReason:'qotd-needs-repair',tasks:[{problem:q('qotd','QOTD'),status:'blocked',feedback:'Provider response was truncated',preparationFailures:3,preparationOutputLimit:4096,submissionAttempts:1,approachHistory:[]}]};
 assert.equal(repairQotdPreparation(run,{maxOutputTokens:4096}),false);
 assert.equal(repairQotdPreparation(run,{maxOutputTokens:16384}),true);
 assert.equal(run.tasks[0].preparationFailures,3);assert.equal(run.tasks[0].preparationLimit,6);assert.equal(run.tasks[0].submissionAttempts,1);
 assert.equal(repairQotdPreparation(run,{maxOutputTokens:16384}),false);
 const initial={old:{...run,id:'old',date,mode:'automatic',username}};
 const f=fixture({initial});f.runner.start({...config,maxOutputTokens:16384},false,2,username);await f.runner.done;
 const current=Object.values(f.runs).find(r=>r.id!=='old');assert.equal(current.status,'completed');
 assert.equal(current.tasks[0].preparationFailures,3);assert.equal(current.tasks[0].preparationLimit,6);
});


test('local syntax service outage retries the same draft without a permanent review gate',async()=>{
 const f=fixture();f.runner.io.verify=async()=>{throw Object.assign(Error('Connection failed'),{kind:'temporary',retryAt:'2026-10-28T06:04:00.000Z'});};
 f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'retrying');assert.equal(run.reviewRequired,undefined);assert.equal(run.skipCount,0);assert.equal(run.nextRetryAt,'2026-10-28T06:04:00.000Z');
 assert.equal(run.tasks[1].status,'queued');assert.equal(f.calls.submit.length,0);
});

test('a new provider reopens bounded preparation for the same pending question and retains failed algorithms',async()=>{
 const {repairQuestionForProviderChange}=await import('../extension/leetcode-runner.js');
 const f=fixture({preflightFail:slug=>slug==='qotd',required:false});f.runner.start(config,false,2,username);await f.runner.done;
 const run=Object.values(f.runs)[0];assert.equal(run.reviewReason,'question-needs-repair');
 const upgraded={...config,providerOrder:['groq','coarena'],models:{groq:'original',coarena:'new-model'}};
 assert.equal(repairQuestionForProviderChange(run,upgraded),true);assert.equal(run.tasks[0].approachLimit,6);assert.equal(run.tasks[0].approachHistory.length,3);assert.equal(run.tasks[0].preparationFailures,0);
 assert.equal(repairQuestionForProviderChange(run,upgraded),false);
 archiveRetryableAutomaticRun(f.runs,run.id,'automatic-history:provider-repair');
 const retry=fixture({initial:f.runs,required:false});retry.runner.start(upgraded,false,2,username);await retry.runner.done;
 const recovered=Object.values(retry.runs).find(r=>r.id===run.id);assert.equal(recovered.status,'completed');assert.equal(recovered.skipCount,0);
 assert.equal(recovered.tasks[0].approachHistory.filter(a=>a.status==='test-failed').length,3);assert.equal(retry.calls.solve[0].plan.number,4);assert.equal(retry.calls.submit.length,2);
});
test('provider preparation repair cannot reopen unknown results or an exhausted judged allowance',async()=>{
 const {repairQuestionForProviderChange}=await import('../extension/leetcode-runner.js');
 const upgraded={providerOrder:['coarena'],models:{coarena:'new-model'}};
 for(const fields of [{submissionAttempts:3},{submissionHistory:[{status:'unknown'}]}]){
  const run={reviewReason:'question-needs-repair',tasks:[{status:'blocked',problem:q('pending'),provider:'groq',...fields}]};
  assert.equal(repairQuestionForProviderChange(run,upgraded),false);
 }
});
