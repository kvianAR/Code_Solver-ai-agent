import fs from 'node:fs';
import {localSyntaxCheck} from './runner.mjs';
export const SERVER_VERSION=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url))).version;
export async function diagnostics(store) {
  const c=store.state.config;
  const labels={working:'connected',key:'key invalid or expired',quota:'quota exhausted',rate:'rate limited',temporary:'temporarily unavailable',request:'check endpoint and model',output:'model returned invalid or incomplete code'};
  let syntax;
  try{syntax=await localSyntaxCheck(c.language==='python'?'pass':'const value = 1;',c.language,{timeoutSeconds:5});}
  catch(error){syntax={ok:false,feedback:error.message};}
  return {version:SERVER_VERSION,node:process.versions.node,platform:process.platform,
    checks:[
      {id:'server',ok:true,message:'Local server connected',action:''},
      {id:'syntax',ok:syntax.ok,message:syntax.feedback,action:syntax.ok?'':'Install Python 3, or choose JavaScript in Settings'},
      ...['groq','gemini',...(c.localAI?.enabled?['local']:[])].map(provider=>({id:provider,ok:(provider==='local'?!!c.localAI.model:!!store.secret(provider))&&store.state.providerHealth?.[provider]?.status==='working',
        message:!(provider==='local'?c.localAI.model:store.secret(provider))?`${provider}: key not saved`:`${provider}: ${labels[store.state.providerHealth?.[provider]?.status]||'not tested'}`,
        action:'Save a key and use Test connection in Settings'}))
    ]};
}
