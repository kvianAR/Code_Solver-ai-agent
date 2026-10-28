import {retryTime,bridgeError} from './retry-policy.js';
import {acceptedDailyTasks,dailyQotdDisposition,deadlineNotice,connectionHealth} from './daily-recovery.js';
import {LeetCodeRunner, qotdSatisfied, archiveRetryableAutomaticRun, automaticRetryDecision, dailyRunForAccount, latestArchivedAutomaticRun, localClock, readinessTarget, loginPrecheckDue, shouldRetryForLaterSchedule} from './leetcode-runner.js';
import {activeContest,contestRefreshDue} from './contest-calendar.js';
import './connection.js';
import './practice-plan.js';
import './failure-guide.js';
import './self-check.js';
async function notify(id,title,message){await chrome.notifications.create(id,{type:'basic',iconUrl:'icon.png',title,message:String(message).slice(0,400)});}
async function serverApi(connection,route,body,signal){const response=await fetch(connection.url+'/api/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(route==='leetcode/solve'?180000:120000)]):AbortSignal.timeout(route==='leetcode/solve'?180000:120000)});const value=await response.json().catch(()=>({}));if(!response.ok)throw bridgeError(value,`Agent request failed (${response.status})`);return value;}
async function waitForTab(tabId){const current=await chrome.tabs.get(tabId);if(current.status==='complete')return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(Error('LeetCode page load timed out'));},30000);const listener=(id,info)=>{if(id===tabId&&info.status==='complete'){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve();}};chrome.tabs.onUpdated.addListener(listener);});}
let preferredLeetCodeTabId=null;
let agentTabCreatePromise=null;
async function createAgentLeetCodeTab(){
  if(!agentTabCreatePromise)agentTabCreatePromise=(async()=>{
    const {agentLeetCodeTabId}=await chrome.storage.local.get('agentLeetCodeTabId');
    if(agentLeetCodeTabId){
      const old=await chrome.tabs.get(agentLeetCodeTabId).catch(()=>null);
      if(old?.url?.startsWith('https://leetcode.com/'))return old;
      await chrome.storage.local.remove('agentLeetCodeTabId');
    }
    const tab=await chrome.tabs.create({url:'https://leetcode.com/problemset/',active:false});
    await chrome.storage.local.set({agentLeetCodeTabId:tab.id});
    return tab;
  })().finally(()=>{agentTabCreatePromise=null;});
  return agentTabCreatePromise;
}
async function closeAgentLeetCodeTab(){
  const {agentLeetCodeTabId}=await chrome.storage.local.get('agentLeetCodeTabId');
  if(!agentLeetCodeTabId)return;
  const tab=await chrome.tabs.get(agentLeetCodeTabId).catch(()=>null);
  if(tab?.url?.startsWith('https://leetcode.com/'))await chrome.tabs.remove(agentLeetCodeTabId).catch(()=>{});
  await chrome.storage.local.remove('agentLeetCodeTabId');
  if(preferredLeetCodeTabId===agentLeetCodeTabId)preferredLeetCodeTabId=null;
}
function startRun(...args){
  const result=runner.start(...args);
  if(result.started)runner.done.finally(()=>closeAgentLeetCodeTab().catch(()=>{})).catch(()=>{});
  return result;
}
function rankLeetCodeTabs(tabs){return [...tabs].sort((a,b)=>{
  if(a.id===preferredLeetCodeTabId)return -1;if(b.id===preferredLeetCodeTabId)return 1;
  if(!!a.discarded!==!!b.discarded)return a.discarded?1:-1;
  if(!!a.active!==!!b.active)return a.active?-1:1;
  if((a.status==='complete')!==(b.status==='complete'))return a.status==='complete'?-1:1;
  return (b.lastAccessed||0)-(a.lastAccessed||0);
});}
async function sendLeetCodeMessage(tab,message,isStopped){
  if(tab.discarded)await chrome.tabs.reload(tab.id);
  await waitForTab(tab.id);if(isStopped())throw Error('Session stopped');
  try{return await chrome.tabs.sendMessage(tab.id,message);}catch(error){
    if(!/receiving end does not exist|could not establish connection/i.test(error.message))throw error;
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['leetcode.js']});
    if(isStopped())throw Error('Session stopped');return chrome.tabs.sendMessage(tab.id,message);
  }
}
async function leetcodeMessage(message,isStopped=()=>false,allowCreate=false){
  const {leetcodeCooldown}=await chrome.storage.local.get('leetcodeCooldown');
  if(Date.parse(leetcodeCooldown?.until)>Date.now())throw Object.assign(Error('LeetCode rate limit; automatic retry is scheduled after the server cooldown'),{kind:'rate',retryAt:leetcodeCooldown.until,...(message.type==='leetcode-submit'?{submissionSent:false}:{})});
  let tabs=rankLeetCodeTabs((await chrome.tabs.query({url:'https://leetcode.com/*'})).filter(tab=>!tab.discarded)),lastResponse,lastError;
  if(!tabs.length){
    if(!allowCreate)throw Error('No LeetCode tab is open');
    tabs=[await createAgentLeetCodeTab()];
  }
  for(const tab of tabs){
    try{
      const response=await sendLeetCodeMessage(tab,message,isStopped);
      if(response?.kind==='rate'){
        const count=(leetcodeCooldown?.failures||0)+1;
        response.retryAt=retryTime(response,Date.now(),count-1);
        // A provided Retry-After is authoritative. Without it, back off across retries/tabs/restarts.
        if(!response.retryAfterProvided)response.retryAt=retryTime({},Date.now(),count-1);
        await chrome.storage.local.set({leetcodeCooldown:{until:response.retryAt,failures:count}});
        if(!runner.active)await chrome.alarms.create('retry-leetcode',{when:Date.parse(response.retryAt)});
      }else if(response?.ok&&['leetcode-preflight','leetcode-submit','leetcode-result'].includes(message.type)&&leetcodeCooldown)await chrome.storage.local.remove('leetcodeCooldown');
      lastResponse=response;
      if(message.type==='leetcode-session'&&response?.ok&&!response.value?.signedIn)continue;
      if(response?.ok)preferredLeetCodeTabId=tab.id;
      return response;
    }catch(error){lastError=error;}
  }
  if(lastResponse)return lastResponse;
  throw lastError||Error('Could not contact a LeetCode tab');
}
async function currentAccount(allowCreate=false){const response=await leetcodeMessage({type:'leetcode-session'},()=>false,allowCreate);if(!response?.ok)throw bridgeError(response,'Could not check the LeetCode login');return response.value?.signedIn?response.value.username:'';}
async function explicitAccount(){
  try{
    const account=await currentAccount(true);
    if(!account){
      await chrome.storage.local.set({leetcodeAccount:'',leetcodeSession:{status:'signed-out',username:'',checkedAt:new Date().toISOString(),error:''}});
      throw Error('Sign in to LeetCode in this browser profile first');
    }
    await chrome.storage.local.set({leetcodeAccount:account,leetcodeSession:{status:'signed-in',username:account,checkedAt:new Date().toISOString(),error:''}});
    return account;
  }catch(error){if(!runner.active)await closeAgentLeetCodeTab();throw error;}
}
let heartbeatAt=0,heartbeatSignature='';
async function reportHeartbeat(connection,run=null,force=false){
  if(!connection)return;
  const saved=await chrome.storage.local.get(['extensionInstanceId','leetcodeRuns','leetcodeAccount','lastState','dailyDiagnostic']);
  const instanceId=saved.extensionInstanceId||crypto.randomUUID();if(!saved.extensionInstanceId)await chrome.storage.local.set({extensionInstanceId:instanceId});
  const date=localClock(saved.lastState?.config?.timezone||'Asia/Kolkata').date;
  run||=runner.currentRun||dailyRunForAccount(saved.leetcodeRuns||{},date,saved.leetcodeAccount)||null;
  const task=run?.tasks?.find(t=>t.problem?.titleSlug===run.currentQuestion)||run?.tasks?.find(t=>['blocked','retrying','waiting','failed'].includes(t.status));
  const message=task?.feedback||run?.feedback||saved.dailyDiagnostic?.message||'';
  const reason=run?.reviewReason==='daily-skip-limit'?'skip-limit':/invalid.*JSON|missing.*code|oversized|truncated|structured/i.test(message)?'output':/quota|provider|API key/i.test(message)?'provider':/429|rate limit/i.test(message)?'rate':/login|sign in|session|csrf|account changed/i.test(message)?'login':/budget|cost/i.test(message)?'budget':/contest.*live/i.test(message)?'contest':/uncertain.*submission|unknown.*result/i.test(message)?'submission':/network|connection|fetch/i.test(message)?'connection':/syntax|wrong answer|testcase|Run Code failed/i.test(message)?'solution':'none';
  const payload={instanceId,version:chrome.runtime.getManifest?.().version||'0.0.0',status:run?.status||'idle',stage:task?.status||'idle',accepted:run?.tasks?.filter(t=>t.status==='accepted').length||0,target:run?.target||saved.lastState?.config?.dailyQuestionCount||0,reason,retryAt:run?.nextRetryAt||saved.dailyDiagnostic?.nextRetryAt||''};
  const signature=JSON.stringify(payload);if(!force&&signature===heartbeatSignature&&Date.now()-heartbeatAt<60000)return;
  await serverApi(connection,'extension/heartbeat',payload,AbortSignal.timeout(5000));heartbeatAt=Date.now();heartbeatSignature=signature;
}
async function saveRun(run) {
  const {leetcodeRuns={}}=await chrome.storage.local.get('leetcodeRuns');
  leetcodeRuns[run.id || run.date]=run;
  await chrome.storage.local.set({leetcodeRuns});
  if(run.mode==='automatic'&&run.status==='retrying'&&run.nextRetryAt&&!run.reviewRequired)await chrome.alarms.create('retry-leetcode',{when:Math.max(Date.now()+1000,Date.parse(run.nextRetryAt))});
  const {connection:progressConnection}=await chrome.storage.local.get('connection');
  await reportHeartbeat(progressConnection,run).catch(()=>{});
  if(progressConnection&&run.mode==='automatic'&&run.username){const accepted=acceptedDailyTasks(leetcodeRuns,run.date,run.username);try{await serverApi(progressConnection,'leetcode/daily-progress',{date:run.date,username:run.username,accepted:accepted.length,qotdAccepted:accepted.some(t=>t.problem?.selection==='QOTD'),qotdExempt:dailyQotdDisposition(leetcodeRuns,run.date,run.username)});}catch{}}
  if(progressConnection&&run.username){const events=(run.tasks||[]).filter(t=>t.status==='accepted'||t.preflightFailures||(t.submissionHistory||[]).some(a=>a.status==='rejected')).slice(0,100).map(t=>({date:run.date,username:run.username,titleSlug:t.problem.titleSlug,title:t.problem.title,topics:t.problem.topics||[],feedback:String(t.feedback||'').slice(0,2000),code:String(t.solution?.code||'').slice(0,3000),accepted:t.status==='accepted',hadFailure:!!t.preflightFailures||(t.submissionHistory||[]).some(a=>a.status==='rejected')}));if(events.length)try{await serverApi(progressConnection,'study/mistakes',events);}catch{}}
  if(run.mode==='automatic'&&run.status==='completed'){
    const {connection}=await chrome.storage.local.get('connection');
    if(connection)try{await serverApi(connection,'leetcode/daily-completion',{date:run.date,username:run.username,accepted:run.tasks.filter(t=>t.status==='accepted').length,target:run.target});}catch{}
  }
}
const runner=new LeetCodeRunner({
  load:async()=>(await chrome.storage.local.get('leetcodeRuns')).leetcodeRuns||{},
  save:saveRun, now:()=>new Date(), uuid:()=>crypto.randomUUID(), notify, session:()=>currentAccount(true),
  result:async(submissionId,username)=>{
    const response=await leetcodeMessage({type:'leetcode-result',submissionId,username},()=>false,true);
    if(!response?.ok)throw bridgeError(response,'Could not recover LeetCode result');
    return response.value;
  },
  discover:async options=>{
    if(options.adaptivePractice&&globalThis.practicePlanner){const {leetcodeRuns={}}=await chrome.storage.local.get('leetcodeRuns');const profile=practicePlanner.profile(leetcodeRuns,options.username,localClock(options.timezone||'Asia/Kolkata').date);options={...options,reviewSlugs:profile.due.map(row=>row.slug).slice(0,10),weakTopics:profile.weakTopics};}
    const response=await leetcodeMessage({type:'leetcode-discover',options},()=>false,true);
    if(!response?.ok)throw bridgeError(response,'Could not read LeetCode');
    return response.value;
  },
  solve:async(problem,feedback,signal,avoidProvider='',sessionId='',context={})=>{
    await requirePracticeWindow();
    const {connection}=await chrome.storage.local.get('connection');
    if(!connection)throw Error('Connect the extension to the agent first');
    return serverApi(connection,'leetcode/solve',{problem,feedback,avoidProvider,sessionId,username:context.username,automatic:context.automatic||sessionId.startsWith('automatic:'),attemptPlan:context.attemptPlan},signal);
  },
  verify:async(problem,code,signal)=>{
    const {connection}=await chrome.storage.local.get('connection');
    if(!connection)throw Error('Connect the extension to the agent first');
    return serverApi(connection,'leetcode/verify',{code,starterCode:problem.starterCode},signal);
  },
  preflight:async(problem,code,username,signal)=>{
    await requirePracticeWindow();
    const response=await leetcodeMessage({type:'leetcode-preflight',problem,code,username},()=>signal?.aborted,true);
    if(!response?.ok)throw bridgeError(response,'LeetCode Run Code failed');
    return response.value;
  },
  submit:async(problem,code,username,signal)=>{
    await requirePracticeWindow();
    const response=await leetcodeMessage({type:'leetcode-submit',problem,code,username},()=>signal?.aborted,true);
    if(!response?.ok)throw bridgeError(response,'LeetCode submission failed');
    return response.value;
  }
});
const ready=runner.recover();
async function requirePracticeWindow(){
  const contests=await refreshContests();
  const live=activeContest(contests);
  if(live)throw Error(`${live.title} is live. AI solving is paused until the contest ends; join and solve it yourself.`);
}
// Storage calls keep an active MV3 session alive while the content script polls
// the judge or discovers new questions. Stop is still checked before submission.
setInterval(()=>{if(runner.active)chrome.storage.local.get('connection').catch(()=>{});},20000);
async function refreshContests(force=false){
  const saved=await chrome.storage.local.get(['leetcodeContests','contestCalendarUpdatedAt','contestCalendarFailedAt','contestCalendarVersion']);
  const oldCalendar=saved.contestCalendarVersion!==2;
  if(!force&&!oldCalendar&&!contestRefreshDue(saved.contestCalendarUpdatedAt))return saved.leetcodeContests||[];
  if(!force&&!oldCalendar&&Date.now()-(saved.contestCalendarFailedAt||0)<3600000)return saved.leetcodeContests||[];
  try{
    const {connection}=await chrome.storage.local.get('connection');
    if(!connection)throw Error('Agent connection is missing');
    const response=await serverApi(connection,`leetcode/contests${force?'?force=1':''}`);
    if(response.error&&!response.events?.length)throw Error(response.error);
    const previous=Object.fromEntries((saved.leetcodeContests||[]).map(c=>[c.id,c]));
    const contests=response.events.map(c=>({...c,openedAt:previous[c.id]?.openedAt||'',reminders:previous[c.id]?.reminders||{}}));
    await chrome.storage.local.set({leetcodeContests:contests,contestCalendarUpdatedAt:response.updatedAt||0,contestCalendarFailedAt:response.failedAt||0,contestCalendarError:response.error||'',contestCalendarVersion:2});
    return contests;
  }catch(error){
    await chrome.storage.local.set({contestCalendarFailedAt:Date.now(),contestCalendarError:error.message});
    if(force)throw error;
    return saved.leetcodeContests||[];
  }
}
async function handleContests(){
  const contests=await refreshContests(),now=Date.now();
  for(const contest of contests){
    const start=new Date(contest.startAt).getTime(),end=new Date(contest.endAt).getTime();
    for(const [name,offset] of [['24h',24*3600000],['1h',3600000]]){
      if(now>=start-offset&&now<start&&!contest.reminders[name]){contest.reminders[name]=new Date().toISOString();await notify(`contest-${contest.id}-${name}`,`${contest.title} upcoming`,`${name==='24h'?'Tomorrow':'In one hour'} at ${new Date(contest.startAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}.`);}
    }
    if(now>=start&&now<end&&!contest.openedAt){
      const url=new URL(contest.url);
      if(url.origin!=='https://leetcode.com'||!/^\/contest\/[a-z0-9-]+\/?$/.test(url.pathname))continue;
      const existing=(await chrome.tabs.query({url:'https://leetcode.com/contest/*'})).find(tab=>tab.url?.replace(/\/?$/,'')===url.href.replace(/\/?$/,''));
      if(!existing)await chrome.tabs.create({url:url.href,active:true});
      contest.openedAt=new Date().toISOString();
      await chrome.storage.local.set({leetcodeContests:contests});
      await notify(`contest-${contest.id}-started`,`${contest.title} started`,'Contest page is open in this browser.');
    }
  }
  await chrome.storage.local.set({leetcodeContests:contests});
}
async function checkDeadline(config,runs,username,diagnostic){
  const notice=deadlineNotice(config,runs,username,diagnostic);if(!notice)return;
  const {dailyDeadlineAlerts={}}=await chrome.storage.local.get('dailyDeadlineAlerts');
  if(dailyDeadlineAlerts[notice.key])return;
  await notify('daily-deadline','Daily allotment is still pending',notice.message);
  dailyDeadlineAlerts[notice.key]=new Date().toISOString();
  for(const key of Object.keys(dailyDeadlineAlerts))if(!key.startsWith(notice.date+':'))delete dailyDeadlineAlerts[key];
  await chrome.storage.local.set({dailyDeadlineAlerts});
}
async function checkCachedDeadline(diagnostic){
  const saved=await chrome.storage.local.get(['lastState','leetcodeRuns','leetcodeAccount']);
  if(saved.lastState?.config)await checkDeadline(saved.lastState.config,saved.leetcodeRuns||{},saved.leetcodeAccount,diagnostic);
}
function pendingResultDue(run){return (run.tasks||[]).some(t=>['blocked','stopped','waiting','retrying'].includes(t.status)&&t.submissionId&&t.submissionHistory?.at(-1)?.status==='unknown')&&(!run.nextResultCheckAt||Date.now()>=Date.parse(run.nextResultCheckAt));}
let pollInFlight=false;
async function poll(){
  if(pollInFlight)return;
  pollInFlight=true;
  try{
  await ready;
  if(globalThis.agentConnection){
    await agentConnection.autoConnect().catch(error=>chrome.storage.local.set({autoConnectError:error.message}));
  }
  const{connection,seenNotifications=[],lastPollAt=0,leetcodeAccount:cachedAccount='',lastAgentLoginCheckAt=0}=await chrome.storage.local.get(['connection','seenNotifications','lastPollAt','leetcodeAccount','lastAgentLoginCheckAt']);
  if(!connection){await checkCachedDeadline({message:'Agent connection is missing. Start Practice Ex. and reconnect.'});await chrome.storage.local.set({dailyDiagnostic:{kind:'connection',message:'Agent connection is missing. Open Settings to connect.',updatedAt:new Date().toISOString()},lastPollAt:Date.now()});return;}
  try{
    await reportHeartbeat(connection).catch(()=>{});
    const state=await serverApi(connection,'state'),fresh=state.notifications.filter(n=>!seenNotifications.includes(n.id));
    for(const n of fresh.slice(0,5).reverse())await notify(n.id,n.title,n.message);
    const {leetcodeCooldown}=await chrome.storage.local.get('leetcodeCooldown');
    if(Date.parse(leetcodeCooldown?.until)>Date.now()){
      const message='LeetCode rate limit. Automatic retry at '+new Date(leetcodeCooldown.until).toLocaleTimeString('en-IN',{timeZone:state.config.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit'})+'. Changing questions cannot clear a server-wide rate limit.';
      await chrome.alarms.create('retry-leetcode',{when:Date.parse(leetcodeCooldown.until)});
      await chrome.storage.local.set({lastState:state,lastConnected:Date.now(),lastPollAt:Date.now(),dailyDiagnostic:{kind:'retrying',message,nextRetryAt:leetcodeCooldown.until,updatedAt:new Date().toISOString()}});
      await checkCachedDeadline({message});return;
    }
    const clock=localClock(state.config.timezone),stored=await chrome.storage.local.get('leetcodeRuns'),leetcodeRuns=stored.leetcodeRuns||{};
    const inactiveGap=!!lastPollAt&&Date.now()-lastPollAt>5*60000;
    let account=cachedAccount,accountError='',accountVerified=false,accountCheckFailed=false;
    if(state.config.leetcode?.enabled){
      const existingTabs=(await chrome.tabs.query({url:'https://leetcode.com/*'})).filter(tab=>!tab.discarded);
      const cachedRun=dailyRunForAccount(leetcodeRuns,clock.date,account)||latestArchivedAutomaticRun(leetcodeRuns,clock.date,account);
      const resultDue=Object.values(leetcodeRuns).some(r=>(!account||r.username?.toLowerCase()===account.toLowerCase())&&pendingResultDue(r));
      const due=state.config.autoMode&&!runner.active&&automaticRetryDecision(cachedRun,state.config).due||resultDue;
      const upcoming=readinessTarget(state.config);
      const precheck=cachedRun?.status!=='completed'&&loginPrecheckDue(state.config,new Date(),lastAgentLoginCheckAt)||upcoming&&upcoming!==clock.date&&Date.now()-lastAgentLoginCheckAt>=10*60000;
      const lastCheck=lastAgentLoginCheckAt?localClock(state.config.timezone,new Date(lastAgentLoginCheckAt)):null;
      const checkAtStart=due&&(!lastCheck||lastCheck.date!==clock.date||lastCheck.time<state.config.dailyStartTime);
      const checkWithTemporaryTab=!existingTabs.length&&(resultDue||precheck||due&&(inactiveGap||['interrupted','review','prepared','completed','retrying','waiting','blocked','failed'].includes(cachedRun?.status)||checkAtStart||Date.now()-lastAgentLoginCheckAt>=3600000));
      if(existingTabs.length||checkWithTemporaryTab){
        if(checkWithTemporaryTab)await chrome.storage.local.set({lastAgentLoginCheckAt:Date.now()});
        try{account=await currentAccount(checkWithTemporaryTab);accountVerified=!!account;}
        catch(error){accountError=error.message;accountCheckFailed=true;}
        if(checkWithTemporaryTab&&(!accountVerified||!due))await closeAgentLeetCodeTab();
        if(accountCheckFailed){
          await chrome.storage.local.set({leetcodeSession:{status:'unavailable',username:cachedAccount,checkedAt:new Date().toISOString(),error:accountError}});
        }else{
          const {leetcodeSession:previousSession,loginAlertDate=''}=await chrome.storage.local.get(['leetcodeSession','loginAlertDate']);
          await chrome.storage.local.set({leetcodeAccount:account,leetcodeSession:{status:accountVerified?'signed-in':'signed-out',username:account,checkedAt:new Date().toISOString(),error:''}});
          if(!accountVerified&&(previousSession?.status==='signed-in'||loginAlertDate!==clock.date)){
            await notify('leetcode-login','LeetCode login needs attention',`Sign in to LeetCode in this browser profile before ${state.config.dailyStartTime} to run daily practice.`);
            await chrome.storage.local.set({loginAlertDate:clock.date});
          }
        }
      }
    }
    if(accountVerified&&!runner.active&&Object.values(leetcodeRuns).some(r=>r.username?.toLowerCase()===account.toLowerCase()&&pendingResultDue(r))){
      await runner.recover(true,account);const latest=await chrome.storage.local.get('leetcodeRuns');Object.assign(leetcodeRuns,latest.leetcodeRuns||{});await closeAgentLeetCodeTab();
    }
    const readinessDate=readinessTarget(state.config);
    const dailyDone=Object.values(leetcodeRuns).some(r=>r.mode==='automatic'&&r.date===readinessDate&&r.username?.toLowerCase()===account.toLowerCase()&&r.tasks.filter(t=>t.status==='accepted').length>=state.config.dailyQuestionCount&&qotdSatisfied(r));
    const readinessSaved=await chrome.storage.local.get(['dailyReadinessAt','dailyReadinessAlert']);
    if(!dailyDone&&state.config.autoMode&&state.config.leetcode?.enabled&&readinessDate&&Date.now()-(readinessSaved.dailyReadinessAt||0)>=10*60000){
      try{const readiness=await serverApi(connection,'readiness?date='+readinessDate);await chrome.storage.local.set({dailyReadiness:readiness,dailyReadinessAt:Date.now()});if((!readiness.ready||!accountVerified)&&readiness.protection?.remaining!==0&&readinessSaved.dailyReadinessAlert!==readinessDate){await notify('daily-readiness','Daily practice needs attention',[!accountVerified?'Verify LeetCode login in this browser profile.':'',...readiness.checks.filter(c=>!c.ok).map(c=>c.action)].filter(Boolean).join(' '));await chrome.storage.local.set({dailyReadinessAlert:readinessDate});}}catch{}
    }
    let live=dailyRunForAccount(leetcodeRuns,clock.date,account),liveKey=live?.id||clock.date;
    const recovered=!live?latestArchivedAutomaticRun(leetcodeRuns,clock.date,account):null;
    let diagnostic={kind:'scheduled',message:`Scheduled for ${state.config.dailyStartTime} ${state.config.timezone}.`,updatedAt:new Date().toISOString()};
    if(state.config.leetcode?.enabled){
      handleContests().catch(()=>{});
      const scheduleMoved=account&&state.config.autoMode&&shouldRetryForLaterSchedule(live,state.config);
      let movedRetryNumber=1;
      if(scheduleMoved&&!runner.active){
        movedRetryNumber=(live.retryNumber||0)+1;
        const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
        if(archiveRetryableAutomaticRun(leetcodeRuns,liveKey,archiveId)){
          await chrome.storage.local.set({leetcodeRuns});
          live=undefined;
        }
      }
      const previousRun=live||recovered;
      const decision=automaticRetryDecision(previousRun,state.config);
      const providerReady=!state.providers||[...(state.config.localAI?.enabled&&!state.config.localAI.cloudFallback?[]:state.config.providerOrder),...(state.config.localAI?.enabled?['local']:[])].some(p=>state.providers[p]?.configured&&!state.disabledProviders?.[p]);
      if(decision.due&&!providerReady){decision.due=false;decision.reason='Configure a working local model or cloud provider in Settings before daily practice can start.';}
      if(!state.config.autoMode)diagnostic={kind:'paused',message:'Auto Mode is off. Turn it on in Settings.',updatedAt:new Date().toISOString()};
      else if(live?.status==='completed'&&!decision.due)diagnostic={kind:'completed',message:`${live.tasks.filter(t=>t.status==='accepted').length}/${state.config.dailyQuestionCount} accepted today.`,updatedAt:new Date().toISOString()};
      else if(accountCheckFailed)diagnostic={kind:'connection',message:`Could not verify the LeetCode session: ${accountError}. This may be temporary; the next scheduled check will retry.`,updatedAt:new Date().toISOString()};
      else if(!accountVerified)diagnostic={kind:'login',message:account?'LeetCode login has not been verified in this browser yet. The next session check will retry.':'LeetCode is signed out in this browser profile. Sign in to resume daily work.',updatedAt:new Date().toISOString()};
      else if(['failed','blocked','waiting','retrying'].includes(previousRun?.status))diagnostic={kind:previousRun.status,message:`${previousRun.tasks.find(t=>['failed','blocked','waiting','retrying'].includes(t.status))?.feedback||previousRun.feedback||'Attempt failed'}. ${decision.reason}.`,nextRetryAt:decision.nextAt||'',updatedAt:new Date().toISOString()};
      else diagnostic={kind:!providerReady?'provider':live?.status||'scheduled',message:decision.reason,updatedAt:new Date().toISOString()};
      if(accountVerified&&decision.due&&!runner.active){
        const resumeTasks=acceptedDailyTasks(leetcodeRuns,clock.date,account);
        const retryNumber=previousRun?(previousRun.retryNumber||0)+1:movedRetryNumber;
        if(live){
          const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
          if(!archiveRetryableAutomaticRun(leetcodeRuns,liveKey,archiveId,state.config.dailyQuestionCount))throw Error('Could not save previous daily attempt');
          await chrome.storage.local.set({leetcodeRuns});
        }
        const started=startRun(state.config,false,state.config.dailyQuestionCount,account,'',resumeTasks,retryNumber);
        if(started.started&&inactiveGap)await chrome.storage.local.set({wakeRecovery:{date:clock.date,username:account,resumedAt:new Date().toISOString(),acceptedRetained:resumeTasks.length}});
        if(started.started)diagnostic={kind:'running',message:inactiveGap?'Missed time while Mac was asleep or the browser inactive; resumed now.':live?'Scheduled retry started for remaining questions.':'Daily questions started.',updatedAt:new Date().toISOString()};
      }
    }
    if(account){
      const accepted=acceptedDailyTasks(leetcodeRuns,clock.date,account),progress={date:clock.date,username:account,accepted:accepted.length,qotdAccepted:accepted.some(t=>t.problem.selection==='QOTD'),qotdExempt:dailyQotdDisposition(leetcodeRuns,clock.date,account)};
      const signature=JSON.stringify(progress)+state.config.dailyQuestionCount;
      const {dailyProgressSync}=await chrome.storage.local.get('dailyProgressSync');
      if(signature!==dailyProgressSync)try{await serverApi(connection,'leetcode/daily-progress',progress);await chrome.storage.local.set({dailyProgressSync:signature});}catch{}
    }
    await checkDeadline(state.config,leetcodeRuns,account,diagnostic);
    const today=state.config.leetcode?.enabled?live:state.jobs.find(j=>j.id==='daily:'+state.today),errors=fresh.some(n=>n.kind==='error')||today?.status==='blocked'||today?.status==='failed';
    const dailyCompleted=today?.status==='completed'&&(!state.config.leetcode?.enabled||today.tasks.filter(t=>t.status==='accepted').length>=state.config.dailyQuestionCount&&qotdSatisfied(today));
    await chrome.action.setBadgeText({text:dailyCompleted?`${state.config.dailyQuestionCount}/${state.config.dailyQuestionCount}`:state.config.leetcode?.enabled&&accountCheckFailed?'CHECK':state.config.leetcode?.enabled&&!account?'LOGIN':state.config.leetcode?.enabled&&!accountVerified?'CHECK':errors?'!':''});
    await chrome.action.setBadgeBackgroundColor({color:errors?'#ef6a65':'#318f79'});
    await chrome.storage.local.set({seenNotifications:state.notifications.map(n=>n.id),lastConnected:Date.now(),lastPollAt:Date.now(),lastState:state,dailyDiagnostic:diagnostic});
  }catch(error){
    await checkCachedDeadline({message:'Agent is unavailable. Start Practice Ex. and check the connection.'});
    await chrome.action.setBadgeText({text:'OFF'});await chrome.action.setBadgeBackgroundColor({color:'#787a91'});
    await chrome.storage.local.set({dailyDiagnostic:{kind:'connection',message:`Agent unavailable: ${error.message}. Will retry on the next poll.`,updatedAt:new Date().toISOString()},lastPollAt:Date.now()});
    const{outageAlertAt=0}=await chrome.storage.local.get('outageAlertAt');
    if(Date.now()-outageAlertAt>3600000){await notify('server-offline','Agent connection unavailable','Check the server or internet connection.');await chrome.storage.local.set({outageAlertAt:Date.now()});}
  }
  }finally{pollInFlight=false;}
}
async function migrateAttemptLabels(){
  const {dailyAttemptPolicyVersion=0,leetcodeRuns={}}=await chrome.storage.local.get(['dailyAttemptPolicyVersion','leetcodeRuns']);
  if(dailyAttemptPolicyVersion>=3)return;
  for(const run of Object.values(leetcodeRuns)){
    for(const task of run.tasks||[]){
      if(task.status==='waiting'){task.status='retrying';if(run.status==='waiting'){run.status='retrying';run.nextRetryAt=new Date(Date.now()+60000).toISOString();}}
      if(task.status==='skipped'&&!task.skipReason){task.status='queued';task.feedback='Not attempted in this earlier run. '+(task.feedback||'');}
      if(task.status==='blocked'&&!run.reviewRequired&&/Pre-submit check unavailable.*(?:429|5\d\d|network|timed out)/i.test(task.feedback||'')){task.status='retrying';if(run.status==='blocked'){run.status='retrying';run.nextRetryAt=new Date(Date.now()+60000).toISOString();}}
    }
  }
  await chrome.storage.local.set({leetcodeRuns,dailyAttemptPolicyVersion:3});
}
async function init(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await ready;await migrateAttemptLabels();if(!runner.active)await closeAgentLeetCodeTab();await chrome.alarms.create('poll-agent',{periodInMinutes:1});await poll();}
globalThis.addEventListener?.('online',()=>poll());
chrome.tabs.onUpdated.addListener((_id,info,tab)=>{if(info.status==='complete'&&tab?.url?.startsWith('https://leetcode.com/'))poll();});
chrome.runtime.onInstalled.addListener(init);chrome.runtime.onStartup.addListener(init);chrome.alarms.onAlarm.addListener(a=>{if(['poll-agent','retry-leetcode'].includes(a.name))poll();});chrome.notifications.onClicked.addListener(id=>chrome.tabs.create({url:chrome.runtime.getURL(id.startsWith('leetcode-run:')?`dashboard.html#run=${encodeURIComponent(id.slice('leetcode-run:'.length))}`:id.startsWith('contest-')?'dashboard.html#contests':'dashboard.html')}));
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message.type==='leetcode-submission-started'&&sender.id===chrome.runtime.id&&sender.tab&&/^https:\/\/leetcode\.com\//.test(sender.url||'')){
    runner.recordSubmission(message.slug,message.submissionId,message.username).then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(sender.id!==chrome.runtime.id || sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')))return;
  if(message.type==='connect-local-agent'){
    (async()=>{await chrome.storage.local.set({autoConnectDisabled:false});const connection=await agentConnection.autoConnect();return {ok:true,connected:!!connection};})().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='extension-live-report'){
    (async()=>{const {connection}=await chrome.storage.local.get('connection');await reportHeartbeat(connection,null,true);return {ok:true};})().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='connection-health'){
    (async()=>{if(message.refresh)await poll();const saved=await chrome.storage.local.get(['connection','lastConnected','lastState','leetcodeSession','autoConnectError','autoConnectDisabled','wakeRecovery']);return {ok:true,checks:connectionHealth(saved),recovery:saved.wakeRecovery||null};})().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='extension-self-check'){
    (async()=>{
      if(runner.active)throw Error('Finish the current session before checking the browser');
      const report=await extensionSelfCheck.run({version:chrome.runtime.getManifest().version,
        permission:()=>chrome.permissions.contains({origins:['http://localhost/*','http://127.0.0.1/*']}),
        connect:async()=>{const connection=await agentConnection.autoConnect();if(!connection)throw Error('connection unavailable');},
        state:async()=>{const {connection}=await chrome.storage.local.get('connection');return serverApi(connection,'state');},
        session:()=>currentAccount(true)});
      await closeAgentLeetCodeTab();await chrome.storage.local.set({extensionSelfCheck:report});return {ok:true,report};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='learning-current-question'){
    (async()=>{
      if(runner.active)throw Error('Finish the current session before opening learning mode');
      await requirePracticeWindow();let [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab?.url?.startsWith('https://leetcode.com/problems/'))tab=(await chrome.tabs.query({url:'https://leetcode.com/problems/*'})).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
      let slug=tab?.url?.match(/^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)(?:\/|$)/)?.[1];
      if(!slug)throw Error('Open a LeetCode question tab, then use Load current question');
      const {connection}=await chrome.storage.local.get('connection'),state=await serverApi(connection,'state');
      const response=await sendLeetCodeMessage(tab,{type:'leetcode-discover',options:{requestedSlug:slug,language:state.config.language}},()=>false);
      if(!response?.ok)throw Error(response?.error||'Could not load the question');await chrome.storage.local.set({learningProblem:response.value.questions[0],learningUsername:response.value.username});return {ok:true,problem:response.value.questions[0],username:response.value.username};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='recover-leetcode-results'){
    (async()=>{await ready;if(runner.active)throw Error('Wait for the current session to finish');await runner.recover(true);await closeAgentLeetCodeTab();return {ok:true};})().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='stop-leetcode') {sendResponse({ok:true,...runner.stop()});return;}
  if(message.type==='leetcode-run-status') {sendResponse({ok:true,activeId:runner.active?.id||null,stopping:!!runner.active?.stop});return;}
  if(message.type==='refresh-leetcode-contests'){refreshContests(true).then(value=>sendResponse({ok:true,value})).catch(error=>sendResponse({ok:false,error:error.message}));return true;}
  if(message.type==='poll'){poll().then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));return true;}
  if(message.type==='daily-schedule-updated'){
    (async()=>{
      await ready;
      const {connection,leetcodeRuns={}}=await chrome.storage.local.get(['connection','leetcodeRuns']);
      if(!connection)throw Error('Connect the extension first');
      const state=await serverApi(connection,'state'),clock=localClock(state.config.timezone);
      const {leetcodeAccount:account=''}=await chrome.storage.local.get('leetcodeAccount');
      const live=dailyRunForAccount(leetcodeRuns,clock.date,account);
      const scheduleChanged=message.previousTime!==state.config.dailyStartTime||message.previousTimezone!==state.config.timezone;
      const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
      const reset=scheduleChanged&&live&&archiveRetryableAutomaticRun(leetcodeRuns,live.id,archiveId);
      if(reset)await chrome.storage.local.set({leetcodeRuns});
      await poll();
      return {ok:true,reset};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='run-leetcode-now'){
    (async()=>{
      await ready;
      const {connection}=await chrome.storage.local.get('connection');
      if(!connection)throw Error('Connect the extension first');
      const state=await serverApi(connection,'state');
      const account=await explicitAccount();
      const count=Math.max(1,Math.min(100,Math.trunc(Number(message.count)||2)));
      return {ok:true,...startRun(state.config,true,count,account)};
    })().then(sendResponse).catch(async error=>{if(!runner.active)await closeAgentLeetCodeTab().catch(()=>{});sendResponse({ok:false,error:error.message});});
    return true;
  }
  if(message.type==='solve-current-question'){
    (async()=>{
      await ready;
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      const url=tab?.url?new URL(tab.url):null;
      const slug=url?.origin==='https://leetcode.com'?url.pathname.match(/^\/problems\/([a-z0-9-]+)\/?(?:.*)?$/)?.[1]:null;
      if(!slug)throw Error('Open a LeetCode question tab, then click Solve this question');
      if(runner.active)throw Error('Another solution is already running');
      const {connection}=await chrome.storage.local.get('connection');
      if(!connection)throw Error('Connect the extension to the agent first');
      const state=await serverApi(connection,'state');
      const response=await sendLeetCodeMessage(tab,{type:'leetcode-session'},()=>false);
      if(!response?.ok)throw Error(response?.error||'Could not check LeetCode login');
      const account=response.value?.signedIn?response.value.username:'';
      if(!account)throw Error('Sign in to LeetCode in this tab first');
      preferredLeetCodeTabId=tab.id;
      return {ok:true,...startRun(state.config,true,1,account,slug)};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='retry-leetcode-today'){
    (async()=>{
      await ready;
      const {connection,leetcodeRuns={}}=await chrome.storage.local.get(['connection','leetcodeRuns']);
      if(!connection)throw Error('Connect the extension first');
      const state=await serverApi(connection,'state'),account=await explicitAccount();
      if(!state.config.autoMode)throw Error('Turn Auto Mode on first');
    const clock=localClock(state.config.timezone),run=dailyRunForAccount(leetcodeRuns,clock.date,account);
      if(!run||!['blocked','waiting','retrying','failed','stopped','interrupted'].includes(run.status))throw Error('No failed automatic run to retry today');
      if(runner.active)throw Error('Another session is already running');
      const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
      if(!archiveRetryableAutomaticRun(leetcodeRuns,run.id||clock.date,archiveId))throw Error('Could not archive the previous run');
      await chrome.storage.local.set({leetcodeRuns});
      return {ok:true,...startRun(state.config,false,state.config.dailyQuestionCount,account,'',(run.tasks||[]).filter(t=>t.status==='accepted'),(run.retryNumber||0)+1)};
    })().then(sendResponse).catch(async error=>{if(!runner.active)await closeAgentLeetCodeTab().catch(()=>{});sendResponse({ok:false,error:error.message});});
    return true;
  }
});
init().catch(()=>{});
