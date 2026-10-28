import {diagnostics} from './diagnostics.mjs';
import {providerOrder,providerAvailable,localModels} from './local-ai.mjs';
import {listModels} from './providers.mjs';

export function dailyProtection(store,date){
  const c=store.state.config;
  if(!c.autoMode||!c.leetcode?.enabled)return {remaining:0,tokens:0,estimatedCostUSD:0};
  const progress=Object.values(store.state.dailyProgress?.[date]||{});
  const completed=store.state.leetcodeDailyCompletion?.[date];
  const remaining=progress.length?progress.reduce((n,row)=>n+Math.max(0,c.dailyQuestionCount-row.accepted,row.qotdAccepted||row.qotdExempt?0:1),0):completed&&completed.accepted>=c.dailyQuestionCount?0:c.dailyQuestionCount;
  const tokens=Math.min(c.dailyTokenBudget,remaining*Math.max(c.dailyReservePerQuestion||6000,(c.maxOutputTokens||4096)+1024));
  const prices=Object.values(c.providerPricing||{}).filter(Boolean).flatMap(row=>[row.inputPerMillion,row.outputPerMillion]).filter(Number.isFinite);
  return {remaining,tokens,estimatedCostUSD:tokens*(prices.length?Math.max(...prices):0)/1e6};
}
export function recordDailyProgress(store,input){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!/^[\w-]{1,40}$/.test(input.username||'')||!Number.isInteger(input.accepted)||input.accepted<0||input.accepted>100||typeof input.qotdAccepted!=='boolean')throw Error('Invalid daily progress');
  if(input.qotdExempt!==undefined&&!['','already-accepted','three-approaches-failed'].includes(input.qotdExempt))throw Error('Invalid QOTD disposition');
  store.state.dailyProgress||={};store.state.dailyProgress[input.date]||={};
  store.state.dailyProgress[input.date]['account:'+input.username.toLowerCase()]={accepted:input.accepted,target:store.state.config.dailyQuestionCount,qotdAccepted:input.qotdAccepted,qotdExempt:input.qotdExempt||'',at:new Date().toISOString()};
  const cutoff=new Date(Date.parse(input.date+'T00:00:00Z')-14*86400000).toISOString().slice(0,10);
  for(const date of Object.keys(store.state.dailyProgress))if(date<cutoff)delete store.state.dailyProgress[date];
  store.save();
}
export async function dailyReadiness(store,date){
  const basic=await diagnostics(store),c=store.state.config,protection=dailyProtection(store,date);
  const candidates=providerOrder(c).filter(p=>providerAvailable(store,p));
  const catalogs=[];
  for(const provider of candidates.filter(p=>p!=='local')){try{const models=await listModels(provider,store.secret(provider),{...c,requestTimeoutSeconds:5});catalogs.push({id:provider+'-catalog',ok:models.includes(c.models[provider]),message:`${provider}: model catalog checked`,action:'Check the selected model and provider access'});}catch{catalogs.push({id:provider+'-catalog',ok:false,message:`${provider}: catalog check unavailable`,action:'Check provider connectivity; generation may still be retried'});}}
  const checks=[...basic.checks.filter(row=>['server','syntax'].includes(row.id)),
    {id:'provider',ok:candidates.length>0,message:candidates.length?'A configured provider is available':'No configured provider is available',action:'Check keys, local model settings and provider cooldowns'},
    {id:'budget',ok:c.dailyTokenBudget-(store.state.usage[date]?.tokens||0)>=Math.max(protection.tokens,protection.remaining*((c.maxOutputTokens||4096)+1)),message:`${protection.tokens} tokens protected for ${protection.remaining} remaining daily questions`,action:'Increase the daily budget if automatic work is blocked'}];
  if(c.localAI?.enabled){try{const models=await localModels(c,store.secret('local'));catalogs.push({id:'local-model',ok:models.includes(c.localAI.model),message:'Local model catalog checked',action:'Choose an installed model or allow cloud fallback'});}catch{catalogs.push({id:'local-model',ok:false,message:'Local model service is unavailable',action:'Start Ollama/LM Studio or allow cloud fallback'});}}
  const ready=protection.remaining===0||checks.every(row=>row.ok)&&catalogs.some(row=>row.ok);
  checks.push(...catalogs);
  const result={date,checkedAt:new Date().toISOString(),checks,protection,ready,providerCheck:'Model catalog access checked without solution generation; generation quota is not guaranteed'};
  store.state.dailyReadiness||={};store.state.dailyReadiness[date]=result;store.save();return result;
}
