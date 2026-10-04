import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,evaluate,summarize,validateSamples} from '../scripts/detector-eval.mjs';

test('detector evaluation reports errors without echoing source code',async()=>{
  const samples=validateSamples([
    {id:'a',expected:'ai',code:'secret source A'},
    {id:'b',expected:'human',code:'secret source B'},
    {id:'c',expected:'human',code:'secret source C'}
  ]);
  const scores={a:0.9,b:0.8,c:0.1};
  const report=await evaluate(samples,'http://127.0.0.1:1234/detect',{fetcher:async(_url,options)=>{
    const {id,code}=JSON.parse(options.body);
    assert.match(code,/secret source/);
    return {ok:true,json:async()=>({score:scores[id]})};
  }});
  assert.deepEqual(report.summary,{truePositive:1,falsePositive:1,trueNegative:1,falseNegative:0,total:3,accuracy:2/3,precision:0.5,recall:1,falsePositiveRate:0.5});
  assert.equal(JSON.stringify(report).includes('secret source'),false);
});

test('detector samples and scores reject invalid data',()=>{
  assert.throws(()=>validateSamples([{id:'a',expected:'human',code:'x'},{id:'a',expected:'ai',code:'y'}]),/unique id/);
  assert.throws(()=>classify(1.2),/score/);
  assert.equal(classify(0.5),'ai');
  assert.equal(summarize([]).accuracy,null);
});
