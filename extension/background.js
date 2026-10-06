import {LeetCodeRunner, archiveRetryableAutomaticRun, automaticRetryDecision, dailyRunForAccount, latestArchivedAutomaticRun, localClock, shouldRetryForLaterSchedule} from './leetcode-runner.js';
import {activeContest,contestRefreshDue} from './contest-calendar.js';
async function notify(id,title,message){await chrome.notifications.create(id,{type:'basic',iconUrl:'icon.png',title,message:String(message).slice(0,400)});}
async function serverApi(connection,route,body,signal){const response=await fetch(connection.url+'/api/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});const value=await response.json().catch(()=>({}));if(!response.ok)throw Error(value.error||`Agent request failed (${response.status})`);return value;}
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
  try{return await chrome.tabs.sendMessage(tab.id,message);}catch{
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['leetcode.js']});
    if(isStopped())throw Error('Session stopped');return chrome.tabs.sendMessage(tab.id,message);
  }
}
async function leetcodeMessage(message,isStopped=()=>false,allowCreate=false){
  let tabs=rankLeetCodeTabs((await chrome.tabs.query({url:'https://leetcode.com/*'})).filter(tab=>!tab.discarded)),lastResponse,lastError;
  if(!tabs.length){
    if(!allowCreate)throw Error('No LeetCode tab is open');
    tabs=[await createAgentLeetCodeTab()];
  }
  for(const tab of tabs){
    try{
      const response=await sendLeetCodeMessage(tab,message,isStopped);
      lastResponse=response;
      if(message.type==='leetcode-session'&&response?.ok&&!response.value?.signedIn)continue;
      if(response?.ok)preferredLeetCodeTabId=tab.id;
      return response;
    }catch(error){lastError=error;}
  }
  if(lastResponse)return lastResponse;
  throw lastError||Error('Could not contact a LeetCode tab');
}
async function currentAccount(allowCreate=false){const response=await leetcodeMessage({type:'leetcode-session'},()=>false,allowCreate);if(!response?.ok)throw Error(response?.error||'Could not check the LeetCode login');return response.value?.signedIn?response.value.username:'';}
async function explicitAccount(){
  try{
    const account=await currentAccount(true);
    if(!account)throw Error('Sign in to LeetCode in this Brave profile first');
    await chrome.storage.local.set({leetcodeAccount:account});
    return account;
  }catch(error){if(!runner.active)await closeAgentLeetCodeTab();throw error;}
}
async function saveRun(run) {
  const {leetcodeRuns={}}=await chrome.storage.local.get('leetcodeRuns');
  leetcodeRuns[run.id || run.date]=run;
  await chrome.storage.local.set({leetcodeRuns});
  if(run.mode==='automatic'&&run.status==='completed'){
    const {connection}=await chrome.storage.local.get('connection');
    if(connection)try{await serverApi(connection,'leetcode/daily-completion',{date:run.date,username:run.username,accepted:run.tasks.filter(t=>t.status==='accepted').length,target:run.target});}catch{}
  }
}
const runner=new LeetCodeRunner({
  load:async()=>(await chrome.storage.local.get('leetcodeRuns')).leetcodeRuns||{},
  save:saveRun, now:()=>new Date(), uuid:()=>crypto.randomUUID(), notify, session:()=>currentAccount(true),
  discover:async options=>{
    const response=await leetcodeMessage({type:'leetcode-discover',options},()=>false,true);
    if(!response?.ok)throw Error(response?.error||'Could not read LeetCode');
    return response.value;
  },
  solve:async(problem,feedback,signal)=>{
    await requirePracticeWindow();
    const {connection}=await chrome.storage.local.get('connection');
    if(!connection)throw Error('Connect the extension to the agent first');
    return serverApi(connection,'leetcode/solve',{problem,feedback},signal);
  },
  verify:async(_problem,code,signal)=>{
    const {connection}=await chrome.storage.local.get('connection');
    if(!connection)throw Error('Connect the extension to the agent first');
    return serverApi(connection,'leetcode/verify',{code},signal);
  },
  submit:async(problem,code,username,signal)=>{
    await requirePracticeWindow();
    const response=await leetcodeMessage({type:'leetcode-submit',problem,code,username},()=>signal?.aborted,true);
    if(!response?.ok)throw Error(response?.error||'LeetCode submission failed');
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
      contest.openedAt=new Date().toISOString();
      await notify(`contest-${contest.id}-started`,`${contest.title} started`,'Open it from the extension timetable when convenient.');
    }
  }
  await chrome.storage.local.set({leetcodeContests:contests});
}
let pollInFlight=false;
async function poll(){
  if(pollInFlight)return;
  pollInFlight=true;
  try{
  await ready;
  const{connection,seenNotifications=[],lastPollAt=0,leetcodeAccount:cachedAccount='',lastAgentLoginCheckAt=0}=await chrome.storage.local.get(['connection','seenNotifications','lastPollAt','leetcodeAccount','lastAgentLoginCheckAt']);
  if(!connection){await chrome.storage.local.set({dailyDiagnostic:{kind:'connection',message:'Agent connection is missing. Open Settings to connect.',updatedAt:new Date().toISOString()},lastPollAt:Date.now()});return;}
  try{
    const state=await serverApi(connection,'state'),fresh=state.notifications.filter(n=>!seenNotifications.includes(n.id));
    for(const n of fresh.slice(0,5).reverse())await notify(n.id,n.title,n.message);
    const clock=localClock(state.config.timezone),stored=await chrome.storage.local.get('leetcodeRuns'),leetcodeRuns=stored.leetcodeRuns||{};
    let account=cachedAccount,accountError='';
    if(state.config.leetcode?.enabled){
      const existingTabs=(await chrome.tabs.query({url:'https://leetcode.com/*'})).filter(tab=>!tab.discarded);
      const cachedRun=dailyRunForAccount(leetcodeRuns,clock.date,account)||latestArchivedAutomaticRun(leetcodeRuns,clock.date,account);
      const due=state.config.autoMode&&!runner.active&&automaticRetryDecision(cachedRun,state.config).due;
      const checkWithTemporaryTab=!existingTabs.length&&due&&Date.now()-lastAgentLoginCheckAt>=3600000;
      if(existingTabs.length||checkWithTemporaryTab){
        if(checkWithTemporaryTab)await chrome.storage.local.set({lastAgentLoginCheckAt:Date.now()});
        try{account=await currentAccount(checkWithTemporaryTab);}
        catch(error){accountError=error.message;account='';}
        if(checkWithTemporaryTab&&!account)await closeAgentLeetCodeTab();
        await chrome.storage.local.set({leetcodeAccount:account});
        if(accountError||!account){
          const {loginAlertAt=0}=await chrome.storage.local.get('loginAlertAt');
          if(Date.now()-loginAlertAt>3600000){await notify('leetcode-login','LeetCode login needs attention',accountError||'Sign in to LeetCode in Brave');await chrome.storage.local.set({loginAlertAt:Date.now()});}
        }
      }
    }
    let live=dailyRunForAccount(leetcodeRuns,clock.date,account),liveKey=live?.id||clock.date;
    const recovered=!live?latestArchivedAutomaticRun(leetcodeRuns,clock.date,account):null;
    let diagnostic={kind:'scheduled',message:`Scheduled for ${state.config.dailyStartTime} ${state.config.timezone}.`,updatedAt:new Date().toISOString()};
    if(state.config.leetcode?.enabled){
      handleContests().catch(()=>{});
      const scheduleMoved=account&&state.config.autoMode&&shouldRetryForLaterSchedule(live,state.config);
      let movedResumeTasks=[],movedRetryNumber=1;
      if(scheduleMoved&&!runner.active){
        movedResumeTasks=(live.tasks||[]).filter(t=>t.status==='accepted');
        movedRetryNumber=(live.retryNumber||0)+1;
        const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
        if(archiveRetryableAutomaticRun(leetcodeRuns,liveKey,archiveId)){
          await chrome.storage.local.set({leetcodeRuns});
          live=undefined;
        }
      }
      const previousRun=live||recovered;
      const decision=automaticRetryDecision(previousRun,state.config);
      const inactiveGap=lastPollAt&&Date.now()-lastPollAt>5*60000;
      if(!state.config.autoMode)diagnostic={kind:'paused',message:'Auto Mode is off. Turn it on in Settings.',updatedAt:new Date().toISOString()};
      else if(!account)diagnostic={kind:'login',message:accountError||'LeetCode is signed out in Brave. Sign in to resume daily work.',updatedAt:new Date().toISOString()};
      else if(live?.status==='completed')diagnostic={kind:'completed',message:`${live.tasks.filter(t=>t.status==='accepted').length}/${live.target} accepted today.`,updatedAt:new Date().toISOString()};
      else if(previousRun?.status==='failed'||previousRun?.status==='blocked')diagnostic={kind:previousRun.status,message:`${previousRun.tasks.find(t=>['failed','blocked'].includes(t.status))?.feedback||previousRun.feedback||'Attempt failed'}. ${decision.reason}.`,nextRetryAt:decision.nextAt||'',updatedAt:new Date().toISOString()};
      else diagnostic={kind:live?.status||'scheduled',message:decision.reason,updatedAt:new Date().toISOString()};
      if(account&&decision.due&&!runner.active){
        const resumeTasks=previousRun?(previousRun.tasks||[]).filter(t=>t.status==='accepted'):movedResumeTasks;
        const retryNumber=previousRun?(previousRun.retryNumber||0)+1:movedRetryNumber;
        if(live){
          const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
          if(!archiveRetryableAutomaticRun(leetcodeRuns,liveKey,archiveId))throw Error('Could not save previous daily attempt');
          await chrome.storage.local.set({leetcodeRuns});
        }
        const started=startRun(state.config,false,state.config.dailyQuestionCount,account,'',resumeTasks,retryNumber);
        if(started.started)diagnostic={kind:'running',message:inactiveGap?'Missed time while Mac was asleep or Brave inactive; resumed now.':live?'Hourly retry started for remaining questions.':'Daily questions started.',updatedAt:new Date().toISOString()};
      }
    }
    const today=state.config.leetcode?.enabled?live:state.jobs.find(j=>j.id==='daily:'+state.today),errors=fresh.some(n=>n.kind==='error')||today?.status==='blocked'||today?.status==='failed';
    await chrome.action.setBadgeText({text:state.config.leetcode?.enabled&&!account?'LOGIN':errors?'!':today?.status==='completed'?`${state.config.dailyQuestionCount}/${state.config.dailyQuestionCount}`:''});
    await chrome.action.setBadgeBackgroundColor({color:errors?'#ef6a65':'#318f79'});
    await chrome.storage.local.set({seenNotifications:state.notifications.map(n=>n.id),lastConnected:Date.now(),lastPollAt:Date.now(),lastState:state,dailyDiagnostic:diagnostic});
  }catch(error){
    await chrome.action.setBadgeText({text:'OFF'});await chrome.action.setBadgeBackgroundColor({color:'#787a91'});
    await chrome.storage.local.set({dailyDiagnostic:{kind:'connection',message:`Agent unavailable: ${error.message}. Will retry on the next poll.`,updatedAt:new Date().toISOString()},lastPollAt:Date.now()});
    const{outageAlertAt=0}=await chrome.storage.local.get('outageAlertAt');
    if(Date.now()-outageAlertAt>3600000){await notify('server-offline','Agent connection unavailable','Check the server or internet connection.');await chrome.storage.local.set({outageAlertAt:Date.now()});}
  }
  }finally{pollInFlight=false;}
}
async function init(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await ready;if(!runner.active)await closeAgentLeetCodeTab();await chrome.alarms.create('poll-agent',{periodInMinutes:1});await poll();}
chrome.runtime.onInstalled.addListener(init);chrome.runtime.onStartup.addListener(init);chrome.alarms.onAlarm.addListener(a=>{if(a.name==='poll-agent')poll();});chrome.notifications.onClicked.addListener(id=>chrome.tabs.create({url:chrome.runtime.getURL(id.startsWith('leetcode-run:')?`dashboard.html#run=${encodeURIComponent(id.slice('leetcode-run:'.length))}`:id.startsWith('contest-')?'dashboard.html#contests':'dashboard.html')}));
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id || sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')))return;
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
      if(!run||!['blocked','failed','stopped','interrupted'].includes(run.status))throw Error('No failed automatic run to retry today');
      if(runner.active)throw Error('Another session is already running');
      const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
      if(!archiveRetryableAutomaticRun(leetcodeRuns,run.id||clock.date,archiveId))throw Error('Could not archive the previous run');
      await chrome.storage.local.set({leetcodeRuns});
      return {ok:true,...startRun(state.config,false,state.config.dailyQuestionCount,account)};
    })().then(sendResponse).catch(async error=>{if(!runner.active)await closeAgentLeetCodeTab().catch(()=>{});sendResponse({ok:false,error:error.message});});
    return true;
  }
});
init().catch(()=>{});
