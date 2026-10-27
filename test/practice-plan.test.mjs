import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/practice-plan.js';
const {profile}=globalThis.practicePlanner;
const task={problem:{titleSlug:'two-sum',title:'Two Sum',topics:['Arrays']},status:'accepted',submissionHistory:[{status:'rejected'},{status:'accepted'}]};
test('topic recommendations isolate accounts and deduplicate archived attempts',()=>{
  const run={date:'2026-10-25',username:'One',tasks:[task]};
  const result=profile({one:run,archive:structuredClone(run),other:{...run,username:'Two'}},'One','2026-10-28');
  assert.equal(result.topics.Arrays.attempted,1);assert.deepEqual(result.weakTopics,['Arrays']);assert.equal(result.due.length,1);
  assert.equal(profile({one:run},'Two','2026-10-28').due.length,0);
});
test('spaced revision advances with distinct accepted days and excludes today',()=>{
  const result=profile({one:{date:'2026-10-25',username:'One',tasks:[task]},two:{date:'2026-10-27',username:'One',tasks:[task]}},'One','2026-10-28');
  assert.equal(result.due.length,0);
  assert.equal(profile({one:{date:'2026-10-28',username:'One',tasks:[task]}},'One','2026-10-28').due.length,0);
});
test('provider and login failures do not mark a topic as weak',()=>{
  const blocked={...task,status:'blocked',submissionHistory:[],preflightFailures:0};
  const result=profile({one:{date:'2026-10-25',username:'One',tasks:[blocked]}},'One','2026-10-28');
  assert.deepEqual(result.weakTopics,[]);assert.equal(result.due.length,0);
});

test('an unresolved algorithm failure is due for revision the next day',()=>{
  const failed={...task,status:'failed',submissionHistory:[{status:'rejected'}]};
  const result=profile({run:{date:'2026-10-25',username:'One',tasks:[failed]}},'One','2026-10-28');
  assert.equal(result.due[0].kind,'retry');assert.equal(result.due[0].slug,'two-sum');
});
