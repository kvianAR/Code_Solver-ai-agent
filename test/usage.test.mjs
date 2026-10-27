import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveUsage} from '../server/usage.mjs';
const date='2026-10-28';
function store(extra={}){return {state:{config:{dailyTokenBudget:10000,sessionTokenBudget:1000,maxSessionCalls:2,providerPricing:{groq:{inputPerMillion:1,outputPerMillion:2}},dailyCostBudgetUSD:0,...extra},usage:{}},save(){}};}
test('concurrent provider reservations cannot exceed the session allowance',()=>{
  const s=store();reserveUsage(s,date,'groq','run','x'.repeat(300),500);
  assert.throws(()=>reserveUsage(s,date,'groq','run','x'.repeat(300),500),/Session budget/);
  assert.equal(s.state.usage[date].calls,1);
});
test('reported usage settles reservations exactly once and records provider cost',()=>{
  const s=store(),held=reserveUsage(s,date,'groq','run','abc',500);
  held.settle({tokens:15,inputTokens:10,outputTokens:5});held.settle({tokens:0,inputTokens:0,outputTokens:0});
  assert.equal(s.state.usage[date].tokens,15);assert.equal(s.state.usage[date].providers.groq.calls,1);
  assert.equal(s.state.usage[date].estimatedCostUSD,0.00002);
});
test('unknown model prices and earlier unpriced calls cannot silently bypass a cost limit',()=>{
  const s=store({dailyCostBudgetUSD:1,providerPricing:{groq:null}});
  assert.throws(()=>reserveUsage(s,date,'groq','run','abc',128),/Set model prices/);
  s.state.config.dailyCostBudgetUSD=0;reserveUsage(s,date,'groq','run','abc',128);
  s.state.config.dailyCostBudgetUSD=1;s.state.config.providerPricing.groq={inputPerMillion:1,outputPerMillion:2};
  assert.throws(()=>reserveUsage(s,date,'groq','run','abc',128),/Earlier calls have unknown cost/);
});
test('failed calls keep conservative reservations and known prices enforce daily cost',()=>{
  const s=store({dailyCostBudgetUSD:0.0005});
  assert.throws(()=>reserveUsage(s,date,'groq','run','abc',500),/Daily estimated cost/);
  s.state.config.dailyCostBudgetUSD=0;reserveUsage(s,date,'groq','run','abc',500);
  assert.equal(s.state.usage[date].tokens,501);
});
test('untrusted session identifiers do not modify object prototypes',()=>{
  const s=store();reserveUsage(s,date,'groq','__proto__','abc',128);
  assert.equal(Object.prototype.tokens,undefined);assert.equal(s.state.usage[date].sessions['manual:'+date].calls,1);
});

test('a denied first request does not create a charged usage record',()=>{
  const s=store({dailyTokenBudget:100});
  assert.throws(()=>reserveUsage(s,date,'groq','run','abc',128),/Daily token budget/);
  assert.equal(s.state.usage[date],undefined);
});

test('malformed provider token splits cannot erase a reserved cost',()=>{
  const s=store(),held=reserveUsage(s,date,'groq','run','abc',500);
  held.settle({tokens:15,inputTokens:-10,outputTokens:25});
  assert.ok(s.state.usage[date].estimatedCostUSD>0);assert.equal(s.state.usage[date].providers.groq.estimatedCalls,1);
});
