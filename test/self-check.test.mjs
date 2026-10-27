import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/failure-guide.js';
import '../extension/self-check.js';
test('browser self-check uses only read-only probes and marks manual scenarios honestly',async()=>{
  const calls=[];
  const result=await globalThis.extensionSelfCheck.run({version:'3.0.0',permission:async()=>true,connect:async()=>calls.push('pair'),state:async()=>({config:{},serverVersion:'3.0.0'}),session:async()=> 'PrivateAccount'});
  assert.equal(result.checks.filter(c=>c.status==='pass').length,4);assert.equal(result.checks.filter(c=>c.status==='manual').length,2);
  assert.deepEqual(calls,['pair']);assert.ok(!JSON.stringify(result).includes('PrivateAccount'));
});
test('a failed browser probe does not claim a complete end-to-end pass',async()=>{
  const result=await globalThis.extensionSelfCheck.run({version:'3.0.0',permission:async()=>false,connect:async()=>{throw Error('Failed to fetch');},state:async()=>({config:{},serverVersion:'2.9.0'}),session:async()=>''});
  assert.equal(result.checks.filter(c=>c.status==='fail').length,4);
});
