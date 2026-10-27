import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDraft} from '../server/verification.mjs';
test('signature verification rejects the wrong method without executing Python code',async()=>{
  const starter='class Solution:\n    def twoSum(self, nums, target):\n        pass';
  const bad=await verifyDraft('class Solution:\n    def unrelated(self):\n        raise Exception("must not execute")',starter,'python',{timeoutSeconds:5});
  assert.equal(bad.ok,false);
  const good=await verifyDraft('class Solution:\n    def twoSum(self, nums, target):\n        raise Exception("must not execute")',starter,'python',{timeoutSeconds:5});
  assert.equal(good.ok,true);assert.equal(good.signatureChecked,true);
});
test('JavaScript verification catches a missing required entry point',async()=>{
  const result=await verifyDraft('var unrelated = function() {};','var twoSum = function(nums, target) {};','javascript',{timeoutSeconds:5});
  assert.equal(result.ok,false);
});

test('a blank-body Python starter still enforces its public method signature',async()=>{
  const result=await verifyDraft('class Solution:\n    def wrong(self, nums):\n        return 0','class Solution:\n    def answer(self, nums):\n        ','python',{timeoutSeconds:5});
  assert.equal(result.ok,false);assert.equal(result.signatureChecked,true);
});
test('mentioning a JavaScript entry point in comments or strings does not satisfy the check',async()=>{
  const result=await verifyDraft('const note = "twoSum"; // var twoSum = function() {};','var twoSum = function(nums,target) {};','javascript',{timeoutSeconds:5});
  assert.equal(result.ok,false);
});
