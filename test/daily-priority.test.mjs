import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyProtection,recordDailyProgress,dailyReadiness} from '../server/daily-readiness.mjs';
import {reserveUsage} from '../server/usage.mjs';
const date='2026-10-28';
function fixture(){return {state:{config:{autoMode:true,leetcode:{enabled:true},dailyQuestionCount:2,dailyTokenBudget:20000,sessionTokenBudget:20000,maxSessionCalls:32,maxOutputTokens:4096,dailyReservePerQuestion:6000,providerPricing:{groq:null},dailyCostBudgetUSD:0},dailyProgress:{},usage:{}},save(){}};}
test('optional work cannot consume the remaining allotted daily allowance',()=>{
  const s=fixture();assert.equal(dailyProtection(s,date).tokens,12000);
  assert.throws(()=>reserveUsage(s,date,'groq','learning:test','abc',9000),/reserved for.*daily/);
  assert.equal(s.state.usage[date],undefined);
  reserveUsage(s,date,'groq','automatic:test','abc',9000,{priority:'daily'});assert.equal(s.state.usage[date].calls,1);
});
test('accepted daily progress releases protection only for completed work including QOTD',()=>{
  const s=fixture();recordDailyProgress(s,{date,username:'Student',accepted:1,qotdAccepted:true});assert.equal(dailyProtection(s,date).tokens,6000);
  recordDailyProgress(s,{date,username:'Student',accepted:2,qotdAccepted:false});assert.equal(dailyProtection(s,date).remaining,1);
  recordDailyProgress(s,{date,username:'Student',accepted:2,qotdAccepted:true});assert.equal(dailyProtection(s,date).tokens,0);
  s.state.config.dailyQuestionCount=3;assert.equal(dailyProtection(s,date).remaining,1);
});
test('account progress cannot overwrite object prototypes and a pause disables reservation',()=>{
  const s=fixture();recordDailyProgress(s,{date,username:'__proto__',accepted:0,qotdAccepted:false});assert.equal(Object.prototype.accepted,undefined);
  s.state.config.autoMode=false;assert.equal(dailyProtection(s,date).tokens,0);
});

test('readiness checks model catalogs without making a generation request',async t=>{
  const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');const {Store}=await import('../server/store.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'practice-readiness-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(dir);s.setSecret('groq','fake-key');
  const original=globalThis.fetch;let requests=0;
  try{globalThis.fetch=async(url)=>{requests++;assert.match(url,/\/models$/);return new Response(JSON.stringify({data:[{id:s.state.config.models.groq}]}));};
    const report=await dailyReadiness(s,date);assert.equal(report.ready,true);assert.equal(requests,1);assert.equal(Object.keys(s.state.usage).length,0);assert.ok(!JSON.stringify(report).includes('fake-key'));
  }finally{globalThis.fetch=original;}
});

test('an explicit QOTD replacement keeps the full acceptance target without reserving an extra QOTD slot',()=>{
  const store={state:{config:{autoMode:true,leetcode:{enabled:true},dailyQuestionCount:2,dailyTokenBudget:100000,maxOutputTokens:4096,dailyReservePerQuestion:6000},dailyProgress:{'2026-10-28':{'account:student':{accepted:2,qotdAccepted:false,qotdExempt:'already-accepted'}}}}};
  assert.equal(dailyProtection(store,'2026-10-28').remaining,0);
  store.state.dailyProgress['2026-10-28']['account:student'].accepted=1;assert.equal(dailyProtection(store,'2026-10-28').remaining,1);
});
