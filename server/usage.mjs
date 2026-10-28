// Reserve before awaiting a provider so concurrent requests cannot overspend a budget.
export function reserveUsage(store,date,provider,sessionId,prompt,maxOutputTokens,options={}) {
  const c=store.state.config,input=Math.ceil(prompt.length/3),tokens=input+maxOutputTokens;
  const usage=store.state.usage[date]||{tokens:0,calls:0};
  usage.providers||={};usage.sessions||={};
  sessionId=typeof sessionId==='string'&&/^[\w:.-]{1,160}$/.test(sessionId)&&!['__proto__','constructor','prototype'].includes(sessionId)?sessionId:'manual:'+date;
  const session=usage.sessions[sessionId]||{tokens:0,calls:0,estimatedCostUSD:0,unpricedCalls:0,startedAt:new Date().toISOString()};
  const totals=usage.providers[provider]||{tokens:0,calls:0,estimatedCostUSD:0,estimatedCalls:0,unpricedCalls:0};
  const rate=provider==='local'?{inputPerMillion:0,outputPerMillion:0}:c.providerPricing?.[provider];
  const priced=rate&&Number.isFinite(rate.inputPerMillion)&&Number.isFinite(rate.outputPerMillion);
  const cost=priced?(input*rate.inputPerMillion+maxOutputTokens*rate.outputPerMillion)/1e6:0;
  if(usage.tokens+tokens>c.dailyTokenBudget)throw Error('Daily token budget reached');
  const protectedWork=dailyProtection(store,date);
  if(!['daily','readiness'].includes(options.priority)&&c.dailyTokenBudget-usage.tokens-tokens<protectedWork.tokens)throw Error('Budget allowance is reserved for the remaining daily allotted questions. Finish daily work before optional practice.');
  if(session.tokens+tokens>(c.sessionTokenBudget||c.dailyTokenBudget)||session.calls>=(c.maxSessionCalls||32))throw Error('Session budget reached; raise the session limit in Settings to continue');
  if(provider!=='local'&&c.dailyCostBudgetUSD>0&&!priced)throw Error('Set model prices before enabling the daily cost budget');
  if(provider!=='local'&&c.dailyCostBudgetUSD>0&&(usage.calls>Object.values(usage.providers).reduce((n,p)=>n+p.calls,0)||Object.values(usage.providers).some(p=>p.unpricedCalls>0||p.unpricedCalls===undefined&&p.calls>0)))throw Error('Earlier calls have unknown cost. Use token limits today and enable the cost budget on the next local day');
  const reservedCost=!['daily','readiness'].includes(options.priority)?protectedWork.estimatedCostUSD:0;
  if(provider!=='local'&&c.dailyCostBudgetUSD>0&&(usage.estimatedCostUSD||0)+cost+reservedCost>c.dailyCostBudgetUSD)throw Error('Daily estimated cost budget reached or reserved for daily work');
  if(session.unpricedCalls===undefined)session.unpricedCalls=session.calls;
  store.state.usage[date]=usage;usage.sessions[sessionId]=session;usage.providers[provider]=totals;
  usage.tokens+=tokens;usage.calls++;usage.estimatedCostUSD=(usage.estimatedCostUSD||0)+cost;
  for(const item of [session,totals]){item.tokens+=tokens;item.calls++;item.estimatedCostUSD+=cost;}
  totals.estimatedCalls++;
  if(!priced){totals.unpricedCalls=(totals.unpricedCalls||0)+1;session.unpricedCalls=(session.unpricedCalls||0)+1;}
  store.save();
  let settled=false;
  return {settle(result){
    if(settled)return;settled=true;
    const valid=value=>Number.isInteger(value)&&value>=0&&value<=1e7;
    const actual=valid(result.tokens)?result.tokens:tokens;
    const split=valid(result.inputTokens)&&valid(result.outputTokens)&&result.inputTokens+result.outputTokens<=actual;
    const actualCost=priced&&split?(result.inputTokens*rate.inputPerMillion+result.outputTokens*rate.outputPerMillion)/1e6:cost;
    for(const item of [usage,session,totals]){item.tokens=Math.max(0,item.tokens-tokens+actual);item.estimatedCostUSD=Math.max(0,item.estimatedCostUSD-cost+actualCost);}
    if(split)totals.estimatedCalls--;
    store.save();
    return {tokens:actual,estimatedCostUSD:priced?actualCost:null,estimated:!split};
  }};
}
import {dailyProtection} from './daily-readiness.mjs';
