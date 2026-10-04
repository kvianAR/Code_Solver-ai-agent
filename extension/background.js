import {LeetCodeRunner, archiveRetryableAutomaticRun, automaticRetryDecision, dailyRunForAccount, latestArchivedAutomaticRun, localClock, shouldRetryForLaterSchedule} from './leetcode-runner.js';
async function notify(id,title,message){await chrome.notifications.create(id,{type:'basic',iconUrl:'icon.png',title,message:String(message).slice(0,400)});}
async function serverApi(connection,route,body,signal){const response=await fetch(connection.url+'/api/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});const value=await response.json().catch(()=>({}));if(!response.ok)throw Error(value.error||`Agent request failed (${response.status})`);return value;}
async function waitForTab(tabId){const current=await chrome.tabs.get(tabId);if(current.status==='complete')return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(Error('LeetCode page load timed out'));},30000);const listener=(id,info)=>{if(id===tabId&&info.status==='complete'){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve();}};chrome.tabs.onUpdated.addListener(listener);});}
let preferredLeetCodeTabId=null;
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
async function leetcodeMessage(message,isStopped=()=>false){
  let tabs=rankLeetCodeTabs(await chrome.tabs.query({url:'https://leetcode.com/*'})),lastResponse,lastError;
  if(!tabs.length)tabs=[await chrome.tabs.create({url:'https://leetcode.com/problemset/',active:false})];
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
async function currentAccount(){const response=await leetcodeMessage({type:'leetcode-session'});if(!response?.ok)throw Error(response?.error||'Could not check the LeetCode login');return response.value?.signedIn?response.value.username:'';}
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
  save:saveRun, now:()=>new Date(), uuid:()=>crypto.randomUUID(), notify, session:currentAccount,
  discover:async options=>{
    const response=await leetcodeMessage({type:'leetcode-discover',options});
    if(!response?.ok)throw Error(response?.error||'Could not read LeetCode');
    return response.value;
  },
  solve:async(problem,feedback,signal)=>{
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
    const response=await leetcodeMessage({type:'leetcode-submit',problem,code,username},()=>signal?.aborted);
    if(!response?.ok)throw Error(response?.error||'LeetCode submission failed');
    return response.value;
  },
  open:async problem=>{
    const url=`https://leetcode.com/problems/${problem.titleSlug}/`;
    const tabs=await chrome.tabs.query({url});
    if(!tabs.length)await chrome.tabs.create({url,active:false});
  }
});
const ready=runner.recover();
// Storage calls keep an active MV3 session alive while the content script polls
// the judge or discovers new questions. Stop is still checked before submission.
setInterval(()=>{if(runner.active)chrome.storage.local.get('connection').catch(()=>{});},20000);
async function refreshContests(force=false){
  const saved=await chrome.storage.local.get(['leetcodeContests','contestCalendarUpdatedAt']);
  if(!force&&Date.now()-(saved.contestCalendarUpdatedAt||0)<6*3600000)return saved.leetcodeContests||[];
  const response=await leetcodeMessage({type:'leetcode-contests'});
  if(!response?.ok)throw Error(response?.error||'Could not load LeetCode contests');
  const previous=Object.fromEntries((saved.leetcodeContests||[]).map(c=>[c.id,c]));
  const contests=response.value.map(c=>({...c,openedAt:previous[c.id]?.openedAt||'',reminders:previous[c.id]?.reminders||{}}));
  await chrome.storage.local.set({leetcodeContests:contests,contestCalendarUpdatedAt:Date.now()});
  return contests;
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
      await notify(`contest-${contest.id}-started`,`${contest.title} started`,'Contest is live. Open it from the extension timetable when convenient.');
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
  const{connection,seenNotifications=[],lastPollAt=0}=await chrome.storage.local.get(['connection','seenNotifications','lastPollAt']);
  if(!connection){await chrome.storage.local.set({dailyDiagnostic:{kind:'connection',message:'Agent connection is missing. Open Settings to connect.',updatedAt:new Date().toISOString()},lastPollAt:Date.now()});return;}
  try{
    const state=await serverApi(connection,'state'),fresh=state.notifications.filter(n=>!seenNotifications.includes(n.id));
    for(const n of fresh.slice(0,5).reverse())await notify(n.id,n.title,n.message);
    const clock=localClock(state.config.timezone),stored=await chrome.storage.local.get('leetcodeRuns'),leetcodeRuns=stored.leetcodeRuns||{};
    let account='',accountError='';
    if(state.config.leetcode?.enabled)try{account=await currentAccount();}catch(error){
      accountError=error.message;
      const {loginAlertAt=0}=await chrome.storage.local.get('loginAlertAt');
      if(Date.now()-loginAlertAt>3600000){await notify('leetcode-login','LeetCode login needs attention',error.message);await chrome.storage.local.set({loginAlertAt:Date.now()});}
    }
    await chrome.storage.local.set({leetcodeAccount:account});
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
        const started=runner.start(state.config,false,state.config.dailyQuestionCount,account,'',resumeTasks,retryNumber);
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
async function init(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.alarms.create('poll-agent',{periodInMinutes:1});await poll();}
chrome.runtime.onInstalled.addListener(init);chrome.runtime.onStartup.addListener(init);chrome.alarms.onAlarm.addListener(a=>{if(a.name==='poll-agent')poll();});chrome.notifications.onClicked.addListener(id=>chrome.tabs.create({url:chrome.runtime.getURL(id.startsWith('leetcode-run:')?`dashboard.html#run=${encodeURIComponent(id.slice('leetcode-run:'.length))}`:'dashboard.html')}));
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
      const account=await currentAccount(),live=dailyRunForAccount(leetcodeRuns,clock.date,account);
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
      const account=await currentAccount();if(!account)throw Error('Sign in to LeetCode in this Brave profile first');
      const count=Math.max(1,Math.min(100,Math.trunc(Number(message.count)||2)));
      return {ok:true,...runner.start(state.config,true,count,account)};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
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
      return {ok:true,...runner.start(state.config,true,1,account,slug)};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='retry-leetcode-today'){
    (async()=>{
      await ready;
      const {connection,leetcodeRuns={}}=await chrome.storage.local.get(['connection','leetcodeRuns']);
      if(!connection)throw Error('Connect the extension first');
      const state=await serverApi(connection,'state'),account=await currentAccount();
      if(!account)throw Error('Sign in to LeetCode in this Brave profile first');
      if(!state.config.autoMode)throw Error('Turn Auto Mode on first');
      const clock=localClock(state.config.timezone),run=dailyRunForAccount(leetcodeRuns,clock.date,account);
      if(!run||!['blocked','failed','stopped','interrupted'].includes(run.status))throw Error('No failed automatic run to retry today');
      if(runner.active)throw Error('Another session is already running');
      const archiveId=`automatic-history:${clock.date}:${crypto.randomUUID()}`;
      if(!archiveRetryableAutomaticRun(leetcodeRuns,run.id||clock.date,archiveId))throw Error('Could not archive the previous run');
      await chrome.storage.local.set({leetcodeRuns});
      return {ok:true,...runner.start(state.config,false,state.config.dailyQuestionCount,account)};
    })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
});
init().catch(()=>{});
