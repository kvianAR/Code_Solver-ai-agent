import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../extension/practice-metrics.js',import.meta.url),'utf8'),context);
test('accuracy counts first judged submission, pre-submit failures and provider outcomes once across archived copies',()=>{
  const task={problem:{titleSlug:'two-sum'},preflightRuns:3,preflightFailures:2,submissionHistory:[
    {at:'2026-10-12T05:00:00Z',fingerprint:'a',provider:'groq',status:'rejected'},
    {at:'2026-10-12T05:02:00Z',fingerprint:'b',provider:'gemini',status:'accepted'}]};
  const runs={one:{date:'2026-10-12',username:'A',tasks:[task]},archived:{date:'2026-10-12',username:'A',tasks:[structuredClone(task)]},other:{date:'2026-10-12',username:'B',tasks:[task]}};
  const result=context.practiceMetrics(runs,'A');
  assert.equal(result.firstTotal,1);
  assert.equal(result.firstAccepted,0);
  assert.equal(result.preflightRuns,3);
  assert.equal(result.preflightFailures,2);
  assert.equal(result.providers.groq.rejected,1);
  assert.equal(result.providers.gemini.accepted,1);
});
