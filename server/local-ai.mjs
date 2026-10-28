export function localBase(config){
  const url=new URL(config.localAI.baseUrl);
  if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('Local AI must use a loopback URL without credentials');
  return url.href.replace(/\/$/,'');
}
export function providerModel(config,provider){return provider==='local'?config.localAI.model:config.models[provider];}
export function providerOrder(config,avoid=''){
  let order=[...config.providerOrder];
  if(config.localAI?.enabled){
    order=!config.localAI.cloudFallback?['local']:config.localAI.preference==='cloud-first'?[...order,'local']:['local',...order];
  }
  return avoid&&order.includes(avoid)?[...order.filter(p=>p!==avoid),avoid]:order;
}
export function providerAvailable(store,provider,now=Date.now()){
  const configured=provider==='local'?store.state.config.localAI?.enabled&&!!store.state.config.localAI.model:!!store.secret(provider);
  return !!configured&&!store.state.disabledProviders?.[provider]&&!(Date.parse(store.state.providerCooldowns?.[provider]?.until)>now);
}
export function cooldown(store,provider,error,now=Date.now()){
  if(!['temporary','rate'].includes(error.kind))return;
  store.state.providerCooldowns||={};
  const seconds=Math.max(error.retryAfter||0,store.state.config.providerCooldownSeconds||120);
  store.state.providerCooldowns[provider]={until:new Date(now+seconds*1000).toISOString(),kind:error.kind};store.save();
}
export async function localModels(config,key='',request=fetch){
  const base=localBase(config),ollama=config.localAI.backend==='ollama';
  const url=ollama?base+'/api/tags':base.replace(/\/v1$/,'')+'/v1/models';
  const r=await request(url,{headers:key?{Authorization:`Bearer ${key}`}:{},signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!r.ok)throw Error(`Local model list unavailable (${r.status})`);
  const data=await r.json();
  return ((ollama?data.models?.map(m=>m.name):data.data?.map(m=>m.id))||[]).filter(id=>typeof id==='string').slice(0,200);
}
export function localRequest(config,key,model,prompt){
  const base=localBase(config),ollama=config.localAI.backend==='ollama';
  return {url:ollama?base+'/api/chat':base.replace(/\/v1$/,'')+'/v1/chat/completions',
    options:{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},
      body:JSON.stringify(ollama?{model,stream:false,format:'json',messages:[{role:'user',content:prompt}],options:{num_predict:config.maxOutputTokens}}:{model,messages:[{role:'user',content:prompt}],max_tokens:config.maxOutputTokens,response_format:{type:'json_object'}})},ollama};
}
