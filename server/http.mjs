import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {validateConfig} from './config.mjs';
import {localTime} from './time.mjs';
import {buildPlan} from './planner.mjs';
import {publicProblem} from './catalog.mjs';
import {complete,decodeSolution,leetcodeSolutionPrompt} from './providers.mjs';
import {localSyntaxCheck} from './runner.mjs';
function authorized(req,token) {const provided=(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(provided),b=Buffer.from(token);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
async function body(req) {let data='';for await(const chunk of req){data+=chunk;if(data.length>150000)throw Error('Request too large');}return data?JSON.parse(data):{};}
export function createServer(store,platform,agent) {
  return http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    // Extension host_permissions permits direct cross-origin fetch without wildcard CORS.
    if(req.method==='GET'&&url.pathname==='/health'){send(200,{ok:true});return;}
    const assets={'/':'dashboard.html','/app.js':'app.js','/style.css':'style.css'};
    if(req.method==='GET'&&assets[url.pathname]){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(fs.readFileSync(new URL('../extension/'+assets[url.pathname],import.meta.url)));return;}
    if(!authorized(req,store.state.adminToken)){send(401,{error:'Connection token required'});return;}
    try {
      const route=`${req.method} ${url.pathname}`;
      if(route==='GET /api/state') {
        agent.chooseProvider(); // Recheck a previous day's quota block before the next scheduled run.
        const state=structuredClone(store.publicState());
        state.jobs=state.jobs.map(j=>({...j,tasks:j.tasks.map(t=>({...t,problem:publicProblem(t.problem)}))}));
        state.today=localTime(new Date(),store.state.config.timezone).date;
        send(200,state);
      }else if(route==='GET /api/catalog'){send(200,(await platform.problems()).map(publicProblem));}
      else if(route==='POST /api/config') {
        const input=await body(req);const old=store.state.config;
        if(agent.running.size&&(['language','platform'].some(k=>JSON.stringify(input[k]??old[k])!==JSON.stringify(old[k]))))throw Error('Pause and finish active work before changing language or platform');
        store.state.config=validateConfig({...old,...input,models:{...old.models,...input.models},platform:{...old.platform,...input.platform},judge:{...old.judge,...input.judge},leetcode:{...old.leetcode,...input.leetcode}});
        for(const provider of ['groq','gemini'])if(input.models?.[provider]&&input.models[provider]!==old.models[provider]){delete store.state.disabledProviders[provider];delete store.state.providerHealth[provider];}
        store.save();
        await buildPlan(store,platform,localTime(new Date(),store.state.config.timezone).date);agent.resumeBlocked();send(200,{ok:true});
      }else if(route==='POST /api/keys') {
        const {provider,key}=await body(req);if(!['groq','gemini','platform'].includes(provider))throw Error('Unknown provider');
        if(typeof key!=='string'||key.length>1000)throw Error('Invalid key');
        store.setSecret(provider,key.trim());agent.resumeBlocked();send(200,{ok:true});
      }else if(route==='POST /api/provider-test') {
        const {provider}=await body(req);if(!['groq','gemini'].includes(provider))throw Error('Unknown provider');
        if(!store.secret(provider))throw Error('Save a key first');
        // This explicit connection test is a paid API call and is counted against the budget.
        const c=store.state.config,d=localTime(new Date(),c.timezone).date,u=store.state.usage[d]||={tokens:0,calls:0};
        if(u.tokens+192>c.dailyTokenBudget)throw Error('Daily token budget reached');u.tokens+=192;u.calls++;store.save();
        let r;
        try{r=await complete(provider,store.secret(provider),c.models[provider],'Return JSON {"ok":true}.',{...c,maxOutputTokens:128});}
        catch(e){store.providerResult(provider,e.kind||'temporary',e.message);throw e;}
        if(Number.isFinite(r.tokens))u.tokens=Math.max(0,u.tokens-192+r.tokens);
        delete store.state.disabledProviders[provider];store.providerResult(provider,'working');agent.resumeBlocked();send(200,{ok:true,message:'Provider connected'});
      }else if(route==='POST /api/run') {
        if(store.state.config.leetcode?.enabled)throw Error('Use the Brave extension to run the live LeetCode session');
        if(!store.state.config.autoMode)throw Error('Turn Auto Mode on first');
        const j=await agent.daily(localTime(new Date(),store.state.config.timezone).date);agent.pump();send(202,{id:j.id});
      }else if(route==='POST /api/leetcode/solve') {
        const input=await body(req),c=store.state.config;
        agent.chooseProvider();
        if(!c.leetcode?.enabled)throw Error('LeetCode browser mode is off');
        if(!input.problem||typeof input.problem.title!=='string'||typeof input.problem.statement!=='string'||typeof input.problem.starterCode!=='string')throw Error('Invalid LeetCode problem');
        if(input.problem.statement.length>90000||input.problem.starterCode.length>30000)throw Error('LeetCode problem is too large');
        let lastError;
        for(const provider of c.providerOrder) {
          if(!store.secret(provider)||store.state.disabledProviders[provider])continue;
          const prompt=leetcodeSolutionPrompt(input.problem,c.language,input.feedback||'');
          const date=localTime(new Date(),c.timezone).date,reserve=Math.ceil(prompt.length/3)+c.maxOutputTokens;
          const usage=store.state.usage[date]||={tokens:0,calls:0};
          if(usage.tokens+reserve>c.dailyTokenBudget)throw Error('Daily token budget reached');
          usage.tokens+=reserve;usage.calls++;store.save();
          try {
            const result=await agent.complete(provider,store.secret(provider),c.models[provider],prompt,c);
            if(Number.isFinite(result.tokens)&&result.tokens>=0)usage.tokens=Math.max(0,usage.tokens-reserve+result.tokens);
            const solution=decodeSolution(result.text);
            store.state.providerActivity={provider,fallbackFrom:provider!==c.providerOrder[0]?c.providerOrder[0]:null,at:new Date().toISOString()};
            store.providerResult(provider,'working');send(200,{...solution,provider,language:c.language});return;
          }catch(e) {
            lastError=e;
            if(e.kind)store.providerResult(provider,e.kind,e.message);
            if(['key','quota','request'].includes(e.kind)) {
              store.state.disabledProviders[provider]={reason:e.message,kind:e.kind,since:new Date().toISOString()};
              agent.notify(`${provider} API needs attention`,e.message+(agent.chooseProvider()?' — trying the configured backup.':' — reconnect a key to resume.'),'error','leetcode');store.save();continue;
            }
            if(['temporary','rate'].includes(e.kind))continue;
            throw e;
          }
        }
        throw lastError||Error('No working Groq or Gemini API key');
      }else if(route==='POST /api/leetcode/verify') {
        const input=await body(req),c=store.state.config;
        if(!c.leetcode?.enabled)throw Error('LeetCode browser mode is off');
        if(typeof input.code!=='string'||!input.code.trim()||input.code.length>60000)throw Error('Invalid draft code');
        send(200,await localSyntaxCheck(input.code,c.language,c.judge));
      }else if(route==='POST /api/leetcode/daily-completion') {
        const input=await body(req);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isInteger(input.accepted)||!Number.isInteger(input.target)||input.target<1||input.target>10||input.accepted<input.target||typeof input.username!=='string'||!input.username)throw Error('Invalid daily completion');
        store.state.leetcodeDailyCompletion[input.date]={username:input.username.slice(0,40),accepted:input.accepted,target:input.target,completedAt:new Date().toISOString()};
        const cutoff=new Date(Date.parse(input.date+'T00:00:00Z')-14*86400000).toISOString().slice(0,10);
        for(const date of Object.keys(store.state.leetcodeDailyCompletion))if(date<cutoff)delete store.state.leetcodeDailyCompletion[date];
        store.save();send(200,{ok:true});
      }else if(route==='POST /api/retry') {const {id}=await body(req);send(202,agent.retry(id));}
      else if(route==='POST /api/plan'){send(200,await buildPlan(store,platform,localTime(new Date(),store.state.config.timezone).date));}
      else if(route==='POST /api/contests') {
        if(store.state.config.platform.type!=='sandbox')throw Error('Manage contests on your connected platform');
        const input=await body(req),start=new Date(input.startAt),end=new Date(input.endAt);
        if(!input.name||typeof input.name!=='string'||input.name.length>100||!Number.isFinite(+start)||!Number.isFinite(+end)||+end<=+start)throw Error('Contest name and valid start/end required');
        if(+start<Date.now()-60000)throw Error('Choose a future start time');
        const all=await platform.problems();
        if(!Array.isArray(input.problemIds)||!input.problemIds.length||input.problemIds.length>10||new Set(input.problemIds).size!==input.problemIds.length||input.problemIds.some(id=>!all.some(p=>p.id===id)))throw Error('Choose 1–10 unique catalog questions');
        const contest={id:crypto.randomUUID(),name:input.name,startAt:start.toISOString(),endAt:end.toISOString(),problemIds:input.problemIds};store.state.contests.push(contest);store.save();
        await buildPlan(store,platform,localTime(new Date(),store.state.config.timezone).date);send(201,contest);
      }else if(route==='DELETE /api/contests') {
        const {id}=await body(req);if(agent.running.has('contest:'+id))throw Error('Cannot delete a running contest');
        store.state.contests=store.state.contests.filter(c=>c.id!==id);store.save();await buildPlan(store,platform,localTime(new Date(),store.state.config.timezone).date);send(200,{ok:true});
      }else send(404,{error:'Not found'});
    }catch(e){if(url.pathname==='/api/provider-test')agent.notify('API connection failed',e.message,'error');send(400,{error:e.message});}
  });
}
