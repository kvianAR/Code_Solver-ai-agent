import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedDailyTasks,deadlineNotice,connectionHealth} from '../extension/daily-recovery.js';
import {unresolvedSubmission} from '../extension/leetcode-runner.js';
const config={autoMode:true,leetcode:{enabled:true},timezone:'Asia/Kolkata',dailyStartTime:'10:00',dailyQuestionCount:2};
const task=(slug,selection='RANDOM')=>({status:'accepted',problem:{titleSlug:slug,selection}});
const run=(tasks,extra={})=>({mode:'automatic',date:'2026-10-28',username:'Student',tasks,...extra});
test('wake recovery unions accepted archived progress only for the same daily account',()=>{
  const runs={a:run([task('qotd','QOTD')]),b:run([task('qotd'),task('second')]),c:run([task('wrong')],{username:'Other'}),d:run([task('manual')],{mode:'manual'}),e:run([task('yesterday')],{date:'2026-10-27'})};
  const tasks=acceptedDailyTasks(runs,'2026-10-28','student');
  assert.deepEqual(tasks.map(t=>t.problem.titleSlug),['qotd','second']);assert.equal(tasks[0].problem.selection,'QOTD');
  assert.deepEqual(acceptedDailyTasks(runs,'2026-10-28',''),[]);
});
test('deadline alerts use local day, remaining allotment, QOTD and distinct warning levels',()=>{
  const runs={a:run([task('qotd','QOTD')])};
  assert.equal(deadlineNotice(config,runs,'Student',{},new Date('2026-10-28T17:29:00Z')),null);
  const first=deadlineNotice(config,runs,'Student',{message:'Server unavailable'},new Date('2026-10-28T17:30:00Z'));
  assert.equal(first.level,60);assert.equal(first.remaining,1);assert.match(first.message,/Server unavailable/);
  const last=deadlineNotice(config,runs,'Student',{},new Date('2026-10-28T18:15:00Z'));assert.equal(last.level,15);assert.notEqual(first.key,last.key);
  assert.equal(deadlineNotice({...config,autoMode:false},runs,'Student',{},new Date('2026-10-28T18:15:00Z')),null);
  assert.equal(deadlineNotice(config,{a:run([task('qotd','QOTD'),task('second')])},'Student',{},new Date('2026-10-28T18:15:00Z')),null);
  assert.equal(deadlineNotice(config,{a:run([task('first'),task('second')])},'Student',{},new Date('2026-10-28T18:15:00Z')).remaining,1);
});
test('duplicate guard blocks unknown submissions across dates and ignores resolved archived copies',()=>{
  const unknown={status:'blocked',problem:{titleSlug:'two-sum'},submissionHistory:[{status:'unknown',submissionId:'123',at:'time',fingerprint:'code'}]};
  const runs={old:run([unknown],{date:'2026-10-27'})};
  assert.ok(unresolvedSubmission(runs,'student','two-sum'));assert.equal(unresolvedSubmission(runs,'Other','two-sum'),undefined);
  runs.latest=run([{...unknown,status:'accepted',submissionHistory:[{...unknown.submissionHistory[0],status:'accepted'}]}],{date:'2026-10-27'});
  assert.equal(unresolvedSubmission(runs,'Student','two-sum'),undefined);
  runs.crash=run([{status:'submitting',problem:{titleSlug:'another'}}]);assert.ok(unresolvedSubmission(runs,'Student','another'));
});
test('connection health never treats a stale heartbeat or cooldown as working',()=>{
  const now=Date.now(),saved={connection:{},lastConnected:now,lastState:{config:{providerOrder:['groq']},providers:{groq:{configured:true}},providerCooldowns:{groq:{until:new Date(now+60000).toISOString()}}},leetcodeSession:{status:'signed-in',username:'Student',checkedAt:new Date(now).toISOString()}};
  let rows=connectionHealth(saved,now);assert.equal(rows.find(r=>r.id==='server').ok,true);assert.equal(rows.find(r=>r.id==='ai').ok,false);
  rows=connectionHealth({...saved,lastConnected:now-300000},now);assert.equal(rows.find(r=>r.id==='server').ok,false);
});
