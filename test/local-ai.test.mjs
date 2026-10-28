import test from 'node:test';
import assert from 'node:assert/strict';
import {localBase,localModels,providerOrder,providerAvailable,cooldown} from '../server/local-ai.mjs';
import {complete} from '../server/providers.mjs';
const config={providerOrder:['groq','gemini'],requestTimeoutSeconds:5,maxOutputTokens:128,localAI:{enabled:true,backend:'ollama',baseUrl:'http://127.0.0.1:11434',model:'coder:7b',cloudFallback:true,preference:'local-first'}};
test('local endpoints are loopback only and fallback remains explicit',()=>{
  assert.deepEqual(providerOrder(config),['local','groq','gemini']);assert.deepEqual(providerOrder({...config,localAI:{...config.localAI,cloudFallback:false}}),['local']);
  for(const baseUrl of ['https://outside.example','http://user:pass@localhost:11434','http://127.0.0.1:11434/?key=secret'])assert.throws(()=>localBase({...config,localAI:{...config.localAI,baseUrl}}));
});
test('Ollama uses local JSON chat, no redirect, and reports input/output usage',async()=>{
  const original=globalThis.fetch;
  try{globalThis.fetch=async(url,options)=>{assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.stream,false);assert.equal(body.format,'json');return new Response(JSON.stringify({message:{content:'{"code":"pass"}'},prompt_eval_count:10,eval_count:5}));};
    const result=await complete('local','','coder:7b','prompt',config);assert.equal(result.tokens,15);
  }finally{globalThis.fetch=original;}
});
test('LM Studio model discovery handles an empty catalog and optional key',async()=>{
  const lm={...config,localAI:{...config.localAI,backend:'lmstudio',baseUrl:'http://localhost:1234/v1'}};
  const models=await localModels(lm,'private',async(url,options)=>{assert.equal(url,'http://localhost:1234/v1/models');assert.equal(options.headers.Authorization,'Bearer private');assert.equal(options.redirect,'error');return new Response('{"data":[]}');});assert.deepEqual(models,[]);
});
test('temporary provider errors enter a bounded cooldown and later become available',()=>{
  const store={state:{config,disabledProviders:{},providerCooldowns:{}},secret:()=> 'key',save(){}};
  cooldown(store,'groq',{kind:'rate',retryAfter:60},1000);assert.equal(providerAvailable(store,'groq',2000),false);assert.equal(providerAvailable(store,'groq',200000),true);
});
