import test from 'node:test';
import assert from 'node:assert/strict';
import {LeetCodeRunner,automaticRetryDecision,archiveRetryableAutomaticRun,hasAcceptedQotd,qotdSatisfied} from '../extension/leetcode-runner.js';
import {dailyQotdDisposition,deadlineNotice} from '../extension/daily-recovery.js';
const date='2026-10-28',username='Student',config={autoMode:true,leetcode:{enabled:true},timezone:'Asia/Kolkata',dailyStartTime:'10:00',dailyQuestionCount:2,maxAttempts:8,language:'python',allowedDifficulties:['Easy','Medium','Hard']};
const q=(titleSlug,selection='RANDOM',difficulty='Easy')=>({titleSlug,title:titleSlug,selection,difficulty,starterCode:'class Solution: pass'});
function fixture({fail=()=>false,preflightFail=()=>false,already=false,repeated=false,initial={},network=false}={}){
 const runs=structuredClone(initial),calls={solve:[],submit:[],discover:[],notices:[]};let id=0,replacement=0;
 const io={now:()=>new Date('2026-10-28T06:00:00Z'),uuid:()=>String(++id),load:async()=>structuredClone(runs),save:async run=>{runs[run.id]=structuredClone(run);},session:async()=>username,
  discover:async options=>{calls.discover.push(options);if(options.allowedDifficulties.length===1&&options.allowedDifficulties[0]==='Easy')return {username,questions:[q('easy-replacement-'+(++replacement))]};return {username,qotdAlreadyAccepted:already?'old-qotd':'',questions:already?[q('new-one'),q('new-two')]:[q('qotd','QOTD','Medium'),q('second')]};},
  solve:async(problem,_feedback,_signal,_provider,_session,context)=>{calls.solve.push({slug:problem.titleSlug,plan:context.attemptPlan});return {code:problem.titleSlug+'-'+(repeated?1:context.attemptPlan.number),approach:repeated?'same-algorithm':'algorithm-'+context.attemptPlan.number,provider:'groq'};},
  verify:async()=>({ok:true}),preflight:async(problem)=>{if(network)throw Error('Run Code unavailable (429)');return {ok:!preflightFail(problem.titleSlug),feedback:'Wrong Answer'};},
  submit:async problem=>{calls.submit.push(problem.titleSlug);return {accepted:!fail(problem.titleSlug),submissionId:String(calls.submit.length),feedback:fail(problem.titleSlug)?'Wrong Answer':'Accepted'};},
  notify:async(...args)=>calls.notices.push(args)};
 return {runner:new LeetCodeRunner(io),runs,calls};
}
test('three different known rejections skip QOTD and an Easy replacement completes the full allotted count',async()=>{
 const f=fixture({fail:slug=>slug==='qotd'});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.tasks.filter(t=>t.status==='accepted').length,2);assert.equal(run.tasks.find(t=>t.problem.titleSlug==='qotd').status,'skipped');
 assert.equal(run.skipCount,1);assert.equal(run.qotdDisposition,'three-approaches-failed');assert.equal(hasAcceptedQotd(run),false);assert.equal(qotdSatisfied(run),true);
 assert.deepEqual(f.calls.solve.filter(r=>r.slug==='qotd').map(r=>r.plan.number),[1,2,3]);assert.equal(f.calls.submit.filter(slug=>slug==='qotd').length,3);
 const replacement=f.calls.discover.at(-1);assert.deepEqual(replacement.allowedDifficulties,['Easy']);assert.equal(replacement.selectionMode,'random');assert.equal(replacement.requireQotd,false);
 assert.equal(dailyQotdDisposition(f.runs,date,username),'three-approaches-failed');assert.equal(deadlineNotice(config,f.runs,username,{},new Date('2026-10-28T18:20:00Z')),null);
});
test('already-accepted QOTD is excluded and the configured number of other questions must be newly accepted',async()=>{
 const f=fixture({already:true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.qotdDisposition,'already-accepted');assert.deepEqual(f.calls.submit,['new-one','new-two']);assert.equal(run.tasks.length,2);assert.ok(!run.tasks.some(t=>t.problem.titleSlug==='old-qotd'));
});
test('three failed test approaches count as a skip but never send failing drafts to the judge',async()=>{
 const f=fixture({preflightFail:slug=>slug==='qotd'});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'completed');assert.equal(run.skipCount,1);assert.equal(f.calls.submit.includes('qotd'),false);assert.equal(run.tasks[0].approachHistory.filter(a=>a.status==='test-failed').length,3);
});
test('the third skipped question stops the daily run, notifies, and cannot be reset by retrying or archives',async()=>{
 const f=fixture({fail:()=>true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.skipCount,3);assert.equal(run.reviewReason,'daily-skip-limit');assert.equal(run.status,'blocked');assert.equal(run.tasks.filter(t=>t.status==='skipped').length,3);assert.equal(f.calls.submit.length,9);assert.equal(f.calls.discover.length,3);
 assert.match(f.calls.notices.at(-1).join(' '),/Three daily skips reached/);assert.equal(automaticRetryDecision(run,config,new Date('2026-10-28T17:00:00Z')).due,false);
 assert.equal(archiveRetryableAutomaticRun(f.runs,run.id,'automatic-history:cap'),true);
 const retry=fixture({initial:f.runs});retry.runner.start(config,false,2,username);await retry.runner.done;assert.equal(retry.calls.solve.length,0);assert.equal(retry.calls.discover.length,0);assert.equal(retry.calls.notices.length,1);
 const other=fixture({initial:f.runs});other.runner.io.session=async()=> 'Other';other.runner.io.discover=async()=>({username:'Other',qotdAlreadyAccepted:'old',questions:[q('other-one'),q('other-two')]});other.runner.start(config,false,2,'Other');await other.runner.done;assert.equal(Object.values(other.runs).find(r=>r.username==='Other').status,'completed');
});
test('429 is waiting, not an approach failure or skip, and untried work stays queued',async()=>{
 const f=fixture({network:true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'waiting');assert.deepEqual(run.tasks.map(t=>t.status),['waiting','queued']);assert.equal(run.skipCount,0);assert.equal(f.calls.submit.length,0);assert.equal(run.tasks[0].approachHistory[0].status,'prepared');assert.equal(run.nextRetryAt,'2026-10-28T06:30:00.000Z');
});
test('repeated algorithms or identical code never count as three different failed approaches',async()=>{
 const f=fixture({fail:()=>true,repeated:true});f.runner.start(config,false,2,username);await f.runner.done;const run=Object.values(f.runs)[0];
 assert.equal(run.status,'waiting');assert.equal(run.skipCount,0);assert.equal(f.calls.submit.length,1);assert.equal(run.tasks[0].approachHistory.length,1);assert.match(run.tasks[0].feedback,/repeated an approach/);
});

test('failed approach history survives a service outage and resumption without resetting the three-approach cap',async()=>{
 const f=fixture({fail:slug=>slug==='qotd'});let checks=0;f.runner.io.preflight=async(problem)=>{if(problem.titleSlug==='qotd'&&++checks===2)throw Error('Run Code unavailable (429)');return {ok:true};};
 f.runner.start(config,false,2,username);await f.runner.done;const old=Object.values(f.runs)[0];assert.equal(old.status,'waiting');assert.equal(old.tasks[0].submissionAttempts,1);
 archiveRetryableAutomaticRun(f.runs,old.id,'automatic-history:outage');const retry=fixture({initial:f.runs,fail:slug=>slug==='qotd'});
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
