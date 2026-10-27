import test from 'node:test';
import assert from 'node:assert/strict';
import {localSyntaxCheck} from '../server/runner.mjs';

const limits={timeoutSeconds:5};

test('local Python syntax check accepts valid drafts and rejects malformed drafts',async()=>{
  assert.equal((await localSyntaxCheck('class Solution:\n    def answer(self):\n        return 42','python',limits)).ok,true);
  const bad=await localSyntaxCheck('class Solution:\n    def broken(','python',limits);
  assert.equal(bad.ok,false);assert.match(bad.feedback,/Syntax error/i);
});

test('local JavaScript syntax check accepts valid drafts and rejects malformed drafts',async()=>{
  assert.equal((await localSyntaxCheck('class Solution { answer() { return 42; } }','javascript',limits)).ok,true);
  const bad=await localSyntaxCheck('class Solution { broken( }','javascript',limits);
  assert.equal(bad.ok,false);assert.match(bad.feedback,/Syntax error/i);
});
