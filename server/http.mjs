import {revisionDeck,answerRevision,weeklyReport} from './practice-insights.mjs';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {validateConfig} from './config.mjs';
import {localTime} from './time.mjs';
import {buildPlan} from './planner.mjs';
import {publicProblem} from './catalog.mjs';
import {ProviderError,complete,decodeSolution,leetcodeSolutionPrompt,listModels,learningPrompt} from './providers.mjs';
import {diagnostics,SERVER_VERSION} from './diagnostics.mjs';
import {refreshOfficialContests} from './contest-calendar.mjs';
import {activeContest} from '../extension/contest-calendar.js';
import {allowPairing} from './pairing.mjs';
import {reserveUsage} from './usage.mjs';
import {verifyDraft} from './verification.mjs';
import {exportBackup,restoreBackup,supportReport} from './backup.mjs';
import {prepareRelease,listSnapshots,launchUpdate} from './releases.mjs';
import path from 'node:path';
import {dailyProtection,recordDailyProgress,dailyReadiness} from './daily-readiness.mjs';
import {providerOrder as generationProviders,providerAvailable,providerModel,cooldown,localModels} from './local-ai.mjs';
import {recordAssistance,recordAttempt,recordMistakes,editMistake,startInterview,interview,reserveInterviewHint,releaseInterviewHint,finishInterview,saveInterviewDraft,studySummary,interviewPrompt,parseInterviewFeedback} from './study.mjs';
function authorized(req,token) {const provided=(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(provided),b=Buffer.from(token);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
async function rawBody(req,limit=150000){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Request too large');chunks.push(chunk);}return Buffer.concat(chunks);}
async function body(req,limit=150000){const data=(await rawBody(req,limit)).toString('utf8');return data?JSON.parse(data):{};}
export function createServer(store,platform,agent,options={}) {
  return http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    // Extension host_permissions permits direct cross-origin fetch without wildcard CORS.
    if(req.method==='GET'&&url.pathname==='/health'){send(200,{ok:true});return;}
    if(req.method==='POST'&&url.pathname==='/api/extension-pair'){
      if(!allowPairing(req,options.pairingKey)){send(403,{error:'Local extension pairing required'});return;}
      send(200,{token:store.state.adminToken});return;
    }
    const assets={'/':'dashboard.html','/app.js':'app.js','/connection.js':'connection.js','/practice-plan.js':'practice-plan.js','/portable-data.js':'portable-data.js','/failure-guide.js':'failure-guide.js','/advanced.js':'advanced.js','/practice-plus.js':'practice-plus.js','/reliability-ui.js':'reliability-ui.js','/practice-metrics.js':'practice-metrics.js','/style.css':'style.css'};
    if(req.method==='GET'&&assets[url.pathname]){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(fs.readFileSync(new URL('../extension/'+assets[url.pathname],import.meta.url)));return;}
    if(!authorized(req,store.state.adminToken)){send(401,{error:'Connection token required'});return;}
    let hintTicket=null;
    try {
      const route=`${req.method} ${url.pathname}`;
      if(route==='GET /api/state') {
        agent.chooseProvider(); // Recheck a previous day's quota block before the next scheduled run.
        const state=structuredClone(store.publicState());
        state.jobs=state.jobs.map(j=>({...j,tasks:j.tasks.map(t=>({...t,problem:publicProblem(t.problem)}))}));
        state.today=localTime(new Date(),store.state.config.timezone).date;
        state.serverVersion=SERVER_VERSION;state.apiVersion=1;state.dailyProtection=dailyProtection(store,state.today);state.dailyReadiness=Object.values(store.state.dailyReadiness).sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt))[0]||null;
        send(200,state);
      }else if(route==='GET /api/readiness'){
        const today=localTime(new Date(),store.state.config.timezone).date,tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10),date=url.searchParams.get('date')||today;
        if(![today,tomorrow].includes(date))throw Error('Readiness checks cover today or the next local day');
        send(200,await dailyReadiness(store,date));
      }else if(route==='POST /api/leetcode/daily-progress'){
        recordDailyProgress(store,await body(req));send(200,{ok:true});
      }else if(route==='GET /api/local-ai/models'){
        send(200,{models:await localModels(store.state.config,store.secret('local'))});
      }else if(route==='POST /api/local-ai/test'){
        const c=store.state.config,date=localTime(new Date(),c.timezone).date;
        if(!c.localAI.enabled||!c.localAI.model)throw Error('Save and enable an installed local model first');
        const prompt=c.language==='python'?'Return only JSON with code: def solve(data): return data, explanation: identity, complexity: O(1)':'Return only JSON with code: function solve(data) { return data; }, explanation: identity, complexity: O(1)';
        const reservation=reserveUsage(store,date,'local','local-test',prompt,256,{priority:'readiness'});
        let generated=false;
        try{
          const result=await agent.complete('local',store.secret('local'),c.localAI.model,prompt,{...c,maxOutputTokens:256});generated=true;reservation.settle(result);
          const solution=decodeSolution(result.text),checked=await verifyDraft(solution.code,'',c.language,c.judge);
          if(!checked.ok)throw Error('Local structured output or syntax check failed');
        }catch(error){
          store.providerResult('local',generated?'request':error.kind||'temporary','Local capability check did not pass');
          if(generated){store.state.disabledProviders.local={kind:'request',reason:'Local structured output or syntax check failed',since:new Date().toISOString()};store.save();}else cooldown(store,'local',error);
          throw error;
        }
        delete store.state.disabledProviders.local;delete store.state.providerCooldowns.local;store.providerResult('local','working');
        send(200,{ok:true,message:'Local JSON generation and syntax passed. Coding quality is not certified.'});
      }else if(route==='GET /api/study'){
        send(200,studySummary(store,url.searchParams.get('username')));
      }else if(route==='GET /api/study/revision'){
      send(200,{questions:revisionDeck(store,url.searchParams.get('username'),localTime(new Date(),store.state.config.timezone).date)});
    }else if(route==='POST /api/study/revision'){
      send(200,answerRevision(store,await body(req),localTime(new Date(),store.state.config.timezone).date));
    }else if(route==='GET /api/study/weekly'){
      send(200,weeklyReport(store,url.searchParams.get('username'),localTime(new Date(),store.state.config.timezone).date));
    }else if(route==='POST /api/study/attempt'){
        send(200,recordAttempt(store,await body(req),localTime(new Date(),store.state.config.timezone).date));
      }else if(route==='POST /api/study/mistakes'){
        send(200,recordMistakes(store,await body(req,4e6)));
      }else if(route==='POST /api/study/note'){
        send(200,editMistake(store,await body(req)));
      }else if(route==='POST /api/interviews/start'){
        send(200,startInterview(store,await body(req,2e6)));
      }else if(route==='POST /api/interviews/finish'){
        send(200,finishInterview(store,await body(req,500000)));
      }else if(route==='POST /api/interviews/draft'){
        send(200,saveInterviewDraft(store,await body(req,500000)));
      }else if(route==='GET /api/backup'){
        send(200,exportBackup(store));
      }else if(route==='POST /api/restore'){
        if(agent.running.size)throw Error('Finish active sessions before restoring');
        send(200,restoreBackup(store,await body(req,50e6)));
      }else if(route==='GET /api/support-report'){
        send(200,supportReport(store,await diagnostics(store)));
      }else if(route==='GET /api/updates'){
        let status=null;try{status=JSON.parse(fs.readFileSync(path.join(store.dir,'update-status.json')));}catch{}
        send(200,{snapshots:listSnapshots(store.dir),status});
      }else if(route==='POST /api/updates/prepare'||route==='POST /api/updates/install'||route==='POST /api/updates/rollback'){
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||! /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host||'')){send(403,{error:'Updates require a local connection'});return;}
        if(agent.running.size)throw Error('Finish active sessions before updating');
        if(route.endsWith('/prepare')){send(200,prepareRelease(store,await rawBody(req,50e6)));return;}
        const rollback=route.endsWith('/rollback');
        if(req.headers['x-practice-update']!==(rollback?'rollback':'install'))throw Error('Confirm the prepared update first');
        const {id}=await body(req);launchUpdate(store,id,rollback);send(202,{ok:true,message:'Local server is restarting. Reload the extension when it is ready.'});
      }else if(route==='GET /api/diagnostics'){
        send(200,await diagnostics(store));
      }else if(route==='GET /api/provider-models'){
        const provider=url.searchParams.get('provider');
        if(!['groq','gemini'].includes(provider)||!store.secret(provider))throw Error('Save a provider key first');
        send(200,{models:await listModels(provider,store.secret(provider),store.state.config)});
      }else if(route==='GET /api/leetcode/contests'){
        send(200,await refreshOfficialContests(store,{force:url.searchParams.get('force')==='1'}));
      }else if(route==='GET /api/catalog'){send(200,(await platform.problems()).map(publicProblem));}
      else if(route==='POST /api/config') {
        const input=await body(req);const old=store.state.config;
        if(agent.running.size&&(['language','platform'].some(k=>JSON.stringify(input[k]??old[k])!==JSON.stringify(old[k]))))throw Error('Pause and finish active work before changing language or platform');
        store.state.config=validateConfig({...old,...input,models:{...old.models,...input.models},platform:{...old.platform,...input.platform},judge:{...old.judge,...input.judge},providerPricing:{...old.providerPricing,...input.providerPricing},localAI:{...old.localAI,...input.localAI},leetcode:{...old.leetcode,...input.leetcode}});
        for(const provider of ['groq','gemini'])if(input.models?.[provider]&&input.models[provider]!==old.models[provider]){delete store.state.disabledProviders[provider];delete store.state.providerHealth[provider];delete store.state.providerCooldowns[provider];if(!input.providerPricing?.[provider])store.state.config.providerPricing[provider]=null;}
        if(input.groqBaseUrl&&input.groqBaseUrl!==old.groqBaseUrl){delete store.state.disabledProviders.groq;delete store.state.providerHealth.groq;delete store.state.providerCooldowns.groq;store.state.config.providerPricing.groq=null;}
        if(input.localAI){delete store.state.disabledProviders.local;delete store.state.providerCooldowns.local;delete store.state.providerHealth.local;}
        store.state.dailyReadiness={};store.save();
        await buildPlan(store,platform,localTime(new Date(),store.state.config.timezone).date);agent.resumeBlocked();send(200,{ok:true});
      }else if(route==='POST /api/keys') {
        const {provider,key}=await body(req);if(!['groq','gemini','platform','local'].includes(provider))throw Error('Unknown provider');
        if(typeof key!=='string'||key.length>1000)throw Error('Invalid key');
        store.setSecret(provider,key.trim());agent.resumeBlocked();send(200,{ok:true});
      }else if(route==='POST /api/provider-test') {
        const {provider}=await body(req);if(!['groq','gemini'].includes(provider))throw Error('Unknown provider');
        if(!store.secret(provider))throw Error('Save a key first');
        // This explicit connection test is a paid API call and is counted against the budget.
        const c=store.state.config,d=localTime(new Date(),c.timezone).date;
        const reservation=reserveUsage(store,d,provider,'provider-test:'+provider,'Return JSON {\"ok\":true}.',128,{priority:'readiness'});
        let r;
        try{r=await complete(provider,store.secret(provider),c.models[provider],'Return JSON {"ok":true}.',{...c,maxOutputTokens:128});}
        catch(e){store.providerResult(provider,e.kind||'temporary',e.message);throw e;}
        reservation.settle(r);
        delete store.state.disabledProviders[provider];delete store.state.providerCooldowns[provider];store.providerResult(provider,'working');agent.resumeBlocked();send(200,{ok:true,message:'Provider connected'});
      }else if(route==='POST /api/run') {
        if(store.state.config.leetcode?.enabled)throw Error('Use the Practice Ex. extension in the signed-in browser to run the live LeetCode session');
        if(!store.state.config.autoMode)throw Error('Turn Auto Mode on first');
        const j=await agent.daily(localTime(new Date(),store.state.config.timezone).date);agent.pump();send(202,{id:j.id});
      }else if((route==='POST /api/leetcode/solve'||route==='POST /api/learning'||route==='POST /api/interviews/feedback')) {
        const input=await body(req,2e6),c=store.state.config;
        const interviewFeedback=route==='POST /api/interviews/feedback';let interviewRow=null;
        if(interviewFeedback){interviewRow=interview(store,input.id,input.username);if(interviewRow.status==='active')throw Error('Finish the interview before requesting feedback');input.problem=interviewRow.problem;input.sessionId='interview:'+interviewRow.id;input.stage='review';input.code=interviewRow.code;}
        const live=activeContest(store.state.contestCalendar?.events);
        if(live)throw Error(`${live.title} is live. AI solving is paused until the contest ends.`);
        agent.chooseProvider();
        if(!c.leetcode?.enabled)throw Error('LeetCode browser mode is off');
        if(!input.problem||typeof input.problem.title!=='string'||typeof input.problem.statement!=='string'||typeof input.problem.starterCode!=='string')throw Error('Invalid LeetCode problem');
        if(input.problem.statement.length>90000||input.problem.starterCode.length>30000)throw Error('LeetCode problem is too large');
        if(input.username!==undefined&&(typeof input.username!=='string'||!/^[\w-]{1,40}$/.test(input.username)))throw Error('Invalid practice account');
        const learning=route==='POST /api/learning'||interviewFeedback;
        if(learning&&input.interviewId){hintTicket=reserveInterviewHint(store,input.interviewId,input.username,input.stage);input.problem=hintTicket.row.problem;input.sessionId='interview:'+hintTicket.row.id;}
        if(learning&&!['hint','approach','review','solution','compare'].includes(input.stage))throw Error('Choose a learning stage');
        if(learning&&['review','compare'].includes(input.stage)&&(typeof input.code!=='string'||!input.code.trim()||input.code.length>60000))throw Error('Paste your code to review');
        let lastError;
        const providers=generationProviders(c,input.avoidProvider);
        for(const provider of providers) {
          if(!providerAvailable(store,provider))continue;
          const prompt=interviewFeedback?interviewPrompt(interviewRow,c.language):learning?learningPrompt(input.problem,c.language,input.stage,input.code||''):leetcodeSolutionPrompt(input.problem,c.language,input.feedback||'',input.attemptPlan||{});
          const date=localTime(new Date(),c.timezone).date;
          let reservation;try{reservation=reserveUsage(store,date,provider,input.sessionId,prompt,c.maxOutputTokens,{priority:!learning&&(input.automatic||String(input.sessionId||'').startsWith('automatic:'))?'daily':'optional'});}catch(error){if(provider!=='local'&&providers.includes('local')&&/cost|prices/i.test(error.message)){lastError=error;continue;}throw error;}
          try {
            const result=await agent.complete(provider,store.secret(provider),providerModel(c,provider),prompt,c);
            const usage=reservation.settle(result);
            let solution;
            if(learning&&input.stage!=='solution'){let value;try{value=JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new ProviderError('Provider returned invalid learning JSON');}if(typeof value.text!=='string'||value.text.length>30000)throw new ProviderError('Provider returned invalid learning guidance');let feedback;if(interviewFeedback){try{feedback=parseInterviewFeedback(value);}catch{throw new ProviderError('Provider returned invalid interview rubric');}}solution={text:value.text,...(interviewFeedback?{feedback}:{})};}
            else solution=decodeSolution(result.text);
            store.state.providerActivity={provider,fallbackFrom:provider!==providers[0]?providers[0]:null,at:new Date().toISOString()};
            if(hintTicket){if(hintTicket.row.status!=='active'||Date.now()>=Date.parse(hintTicket.row.deadline))throw Error('Interview ended before the hint was ready');hintTicket.finished=true;}
            if(interviewFeedback){interviewRow.feedback=solution;store.save();}
            recordAssistance(store,date,input.username,input.problem,learning?input.stage:'solution');
            delete store.state.providerCooldowns[provider];store.providerResult(provider,'working');send(200,{...solution,provider,language:c.language,usage,...(learning?{stage:input.stage}:{})});return;
          }catch(e) {
            lastError=e;
            if(e.kind)store.providerResult(provider,e.kind,e.message);cooldown(store,provider,e);
            if(['key','quota','request'].includes(e.kind)) {
              store.state.disabledProviders[provider]={reason:e.message,kind:e.kind,since:new Date().toISOString()};
              agent.notify(`${provider} API needs attention`,e.message+(agent.chooseProvider()?' — trying the configured backup.':' — reconnect a key to resume.'),'error','leetcode');store.save();continue;
            }
            if(['temporary','rate'].includes(e.kind))continue;
            throw e;
          }
        }
        throw lastError||Error('No provider is ready. Check local model settings, keys and provider cooldowns.');
      }else if(route==='POST /api/leetcode/verify') {
        const input=await body(req),c=store.state.config;
        if(!c.leetcode?.enabled)throw Error('LeetCode browser mode is off');
        if(typeof input.code!=='string'||!input.code.trim()||input.code.length>60000)throw Error('Invalid draft code');
        send(200,await verifyDraft(input.code,String(input.starterCode||'').slice(0,30000),c.language,c.judge));
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
    }catch(e){releaseInterviewHint(store,hintTicket);if(url.pathname==='/api/provider-test')agent.notify('API connection failed',e.message,'error');send(400,{error:e.message});}
  });
}
