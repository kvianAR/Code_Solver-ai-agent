const $=s=>document.querySelector(s);
const extension=typeof chrome!=='undefined'&&!!chrome.runtime?.id;
const UI_BUILD='2.8.4';
if(extension)chrome.storage.local.get('uiBuild').then(({uiBuild})=>{if(uiBuild!==UI_BUILD)chrome.storage.local.set({uiBuild:UI_BUILD}).then(()=>chrome.runtime.reload());});
let connection=null,state=null,catalog=[],page='today',busy=false,leetcodeRuns={},leetcodeContests=[],contestCalendarUpdatedAt=0,contestCalendarError='',liveRun=null,leetcodeAccount='',activeRunId=null,stopping=false,dailyDiagnostic=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pill=(text,type='')=>`<span class="pill ${type}">${esc(text)}</span>`;
const getManualCount=()=>Math.max(1,Math.min(100,Math.trunc(Number($('#manual-count')?.value)||2)));
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,6000);}
async function api(route,body,method){
  const r=await fetch(connection.url+'/api/'+route,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(route==='provider-test'?180000:30000)});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Request failed');return value;
}
async function loadConnection(){
  if(extension)return(await chrome.storage.local.get('connection')).connection;
  try{
    const saved=localStorage.getItem('connection')||sessionStorage.getItem('connection');
    if(!saved)return null;
    localStorage.setItem('connection',saved);sessionStorage.removeItem('connection');
    return JSON.parse(saved);
  }catch{return null;}
}
async function saveConnection(value){
  if(extension){await chrome.storage.local.set({connection:value});return;}
  if(value)localStorage.setItem('connection',JSON.stringify(value));else localStorage.removeItem('connection');
}
function formatDate(value,options={}){return new Intl.DateTimeFormat('en-IN',{timeZone:state?.config.timezone||'Asia/Kolkata',...options}).format(new Date(value));}
function dateOnly(value){return new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).format(new Date(value+'T12:00:00Z'));}
function streak(){const dates=new Set(state.jobs.filter(j=>j.type==='daily'&&j.status==='completed').map(j=>j.date));let date=state.today,count=0;if(!dates.has(date))date=previous(date);while(dates.has(date)){count++;date=previous(date);}return count;}
function previous(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
function taskCard(t,index){const ready=['ready','accepted'].includes(t.status),url=t.problem?.titleSlug?`https://leetcode.com/problems/${encodeURIComponent(t.problem.titleSlug)}/`:'';return `<article class="card"><div class="task-head"><span class="eyebrow">QUESTION ${index+1} · ${esc(t.problem.selection||'TEST CONTEST')}</span>${pill(t.status,t.status==='failed'||t.status==='blocked'?'error':ready?'':'pending')}</div><h3>${esc(t.problem.title)}</h3><div class="task-details">${pill(t.problem.difficulty)}<span>${esc(t.problem.topic)}</span></div><p>${esc(t.problem.statement)}</p><small>${t.attempts} attempts${t.provider?' · '+esc(t.provider):''}</small>${t.feedback?`<p class="${t.status==='blocked'||t.status==='failed'?'error-text':''}">${esc(t.feedback)}</p>`:''}${url&&ready?`<p><a class="primary link-button" href="${url}" target="_blank" rel="noreferrer">Open & review on LeetCode</a></p>`:''}${t.solution?`<details><summary>Draft solution & explanation</summary><p>${esc(t.solution.explanation)}</p><small>${esc(t.solution.complexity)}</small><pre>${esc(t.solution.code)}</pre></details>`:''}</article>`;}
function render(){
  $('#workspace').hidden=false;$('#connect-panel').hidden=true;$('#connection-dot').classList.add('online');$('#connection-status').textContent='Agent connected';
  const c=state.config,job=c.leetcode?.enabled?liveRun:state.jobs.find(j=>j.id==='daily:'+state.today),usage=state.usage[state.today];
  $('#today-date').textContent=dateOnly(state.today).toUpperCase();$('#daily-count').textContent=`${job?.tasks.filter(t=>['ready','accepted'].includes(t.status)).length||0} / ${job?.target||c.dailyQuestionCount}`;$('#daily-status').textContent=job?.status||'Scheduled';$('#streak').innerHTML=`${c.leetcode?.enabled?liveStreak():streak()} <em>days</em>`;
  $('#start-time').textContent=c.dailyStartTime;$('#timezone-label').textContent=c.timezone;$('#token-count').textContent=(usage?.tokens||0).toLocaleString();$('#token-budget').textContent=`${c.dailyTokenBudget.toLocaleString()} daily budget · ${usage?.calls||0} calls`;$('#auto-label').textContent=c.autoMode?'Auto Mode ON':'Auto Mode paused';$('#run-now').textContent=c.leetcode?.enabled?`▶ Prepare ${getManualCount()} now`:"▶ Run today's session";$('#run-now').disabled=c.leetcode?.enabled?(!extension||!!activeRunId):(!c.autoMode||job?.status==='running');$('#stop-solving').hidden=!c.leetcode?.enabled;$('#stop-solving').disabled=!activeRunId||stopping;$('#stop-solving').textContent=stopping?'Stopping…':'■ Stop';
  const active=Object.values(leetcodeRuns).find(r=>(r.id||r.date)===activeRunId);
  $('#live-session-status').textContent=stopping?'Stopping draft preparation':activeRunId?`${active?.mode==='manual'?'Manual':'Automatic'} draft preparation running`:leetcodeAccount?`Ready for ${leetcodeAccount}`:'Sign in to LeetCode in this Brave profile';
  $('#live-session-help').textContent=c.leetcode?.enabled&&!extension?'Open the Practice Ex. extension in Brave to run account submissions.':`Automatic: ${c.dailyStartTime} every day. Solutions are generated, syntax-checked, submitted to LeetCode, and retried until accepted or the attempt limit is reached.`;
  $('#daily-diagnosis').textContent=extension&&c.leetcode?.enabled?(dailyDiagnostic?.message||'Waiting for the next scheduler check.'):'Browser schedule diagnostics appear in the extension dashboard.';
  $('#next-retry').textContent=dailyDiagnostic?.nextRetryAt?`Next retry: ${esc(formatDate(dailyDiagnostic.nextRetryAt,{hour:'2-digit',minute:'2-digit'}))} · ${c.timezone}`:'';
  $('#retry-daily').hidden=!extension||!c.leetcode?.enabled||!leetcodeAccount||!['blocked','failed','stopped','interrupted'].includes(liveRun?.status);
  const manual=Object.values(leetcodeRuns).filter(r=>r.mode==='manual'&&r.username?.toLowerCase()===leetcodeAccount.toLowerCase()).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
  $('#manual-section').hidden=!manual||!c.leetcode?.enabled;
  $('#manual-status').textContent=manual?`${manual.tasks.filter(t=>['ready','accepted'].includes(t.status)).length}/${manual.target} · ${manual.status}`:'';
  $('#manual-tasks').innerHTML=manual?(manual.tasks.length?manual.tasks.map(taskCard).join(''):`<article class="card"><p>${esc(manual.feedback||'Selecting untouched questions…')}</p></article>`):'';
  const day=state.plan?.days.find(d=>d.date===state.today);
  $('#today-tasks').innerHTML=job?`${job.selectionNote?`<p class="muted">${esc(job.selectionNote)}</p>`:''}${job.tasks.length?job.tasks.map(taskCard).join(''):`<article class="card"><p class="error-text">${esc(job.feedback||'Question discovery has not finished.')}</p></article>`}`:`<article class="card"><span class="eyebrow">DAILY PRACTICE</span><h3>${leetcodeAccount?'Scheduled for '+leetcodeAccount:'LeetCode login required'}</h3><p>${leetcodeAccount?`Questions will be selected at ${esc(c.dailyStartTime)}.`:'Sign in to LeetCode in this Brave profile to start automatic practice.'}</p>${pill('Scheduled','pending')}</article>`;
  $('#notifications').innerHTML=state.notifications.length?state.notifications.slice(0,12).map(n=>`<div class="notice ${n.kind==='error'?'error':''}"><div><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p></div><time>${esc(formatDate(n.createdAt,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></div>`).join(''):'<p class="empty">Your next session will appear here.</p>';
  $('#plan-days').innerHTML=state.plan?.days.map(d=>`<article class="card plan-day ${d.date===state.today?'current':''}"><div class="task-head"><span class="date">${esc(dateOnly(d.date))}</span>${pill(state.jobs.find(j=>j.id==='daily:'+d.date)?.status||d.status,'pending')}</div><small>${esc(d.time)} · ${esc(c.timezone)}</small><ol>${d.qotd?'<li>QOTD — selected on the day</li>':''}${d.questions.map(p=>`<li>${esc(p.title)} ${p.review?'↻':''}<br><small>${esc(p.difficulty)} · ${esc(p.topic)}</small></li>`).join('')}</ol>${leetcodeContests.filter(t=>new Intl.DateTimeFormat('en-CA',{timeZone:c.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t.startAt))===d.date).map(t=>`<small>⚑ ${esc(t.title)} · ${esc(formatDate(t.startAt,{hour:'2-digit',minute:'2-digit'}))}</small>`).join('')}</article>`).join('')||'<p class="empty">Plan will be generated when the agent connects.</p>';
  const now=Date.now(),contestState=t=>now<Date.parse(t.startAt)?'Upcoming':now<Date.parse(t.endAt)?'Live':'Ended';
  const upcoming=leetcodeContests.filter(t=>contestState(t)!=='Ended').length,ended=leetcodeContests.length-upcoming;
  $('#auto-contest-summary').innerHTML=`<span class="eyebrow">OFFICIAL LEETCODE CALENDAR</span><h2>${upcoming} upcoming · ${ended} recent</h2><p>Checked ${contestCalendarUpdatedAt?esc(formatDate(contestCalendarUpdatedAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})):'not yet'} · automatic refresh about three times a week. Live contests open in a background tab and send a reminder.</p>${contestCalendarError?`<p class="error-text">Latest refresh failed: ${esc(contestCalendarError)}. Saved events remain visible.</p>`:''}`;
  $('#contest-list').innerHTML=leetcodeContests.length?[...leetcodeContests].sort((a,b)=>(contestState(a)==='Ended')-(contestState(b)==='Ended')||Date.parse(a.startAt)-Date.parse(b.startAt)).map(t=>`<article class="card"><div class="task-head"><h2>${esc(t.title)}</h2>${pill(contestState(t),contestState(t)==='Upcoming'?'pending':'')}</div><p>${esc(formatDate(t.startAt,{weekday:'long',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))} · ${esc(c.timezone)}<br>${Math.round((new Date(t.endAt)-new Date(t.startAt))/60000)} minutes${t.openedAt?' · opened at start':''}</p><a class="primary link-button" href="${esc(t.url)}" target="_blank" rel="noreferrer">Open contest</a></article>`).join(''):'<div class="card empty">No recent or upcoming contest found. Use Refresh contests to check LeetCode now.</div>';
  if(!$('#page-history details[open]'))$('#history').innerHTML=state.jobs.length?[...state.jobs].reverse().map(j=>`<article class="card"><div class="task-head"><h2>${esc(j.contestName||'Daily · '+j.date)}</h2>${pill(j.status,j.status==='failed'||j.status==='blocked'?'error':'')}</div><small>${j.tasks.filter(t=>t.status==='accepted').length}/${j.target||j.tasks.length} accepted</small>${['failed','blocked'].includes(j.status)?` <button class="quiet" data-retry="${esc(j.id)}">Retry pending</button>`:''}<div class="task-grid">${j.tasks.map(taskCard).join('')}</div></article>`).join(''):'<div class="card empty">Your sessions will be saved here.</div>';
  if(extension&&c.leetcode?.enabled&&!$('#page-history details[open]')){
    const sessions=Object.values(leetcodeRuns).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
    $('#history').innerHTML=sessions.map(r=>`<article class="card" data-run-id="${esc(r.id)}"><div class="task-head"><h2>${r.mode==='manual'?'Manual':'Automatic'} · ${esc(formatDate(r.startedAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</h2>${pill(r.status,['failed','blocked','interrupted'].includes(r.status)?'error':'')}</div><small>${r.tasks.filter(t=>['ready','accepted'].includes(t.status)).length}/${r.target||c.dailyQuestionCount} accepted · ${esc(r.username||'account unknown')}</small>${r.feedback?`<p class="error-text">${esc(r.feedback)}</p>`:''}<div class="task-grid">${r.tasks.map(taskCard).join('')}</div></article>`).join('')||'<div class="card empty">Manual and automatic practice drafts will appear here.</div>';
  }
  if(!$('#page-settings').contains(document.activeElement))renderSettings();
}
function renderSettings(){
  const c=state.config,f=$('#settings-form');
  for(const key of ['dailyStartTime','timezone','dailyQuestionCount','language','maxAttempts','dailyTokenBudget','notificationWebhook'])f.elements[key].value=c[key];
  f.elements.providerOrder.value=c.providerOrder.join(',');
  f.elements.autoMode.checked=c.autoMode;f.elements.preferQuestionOfTheDay.checked=true;
  for(const d of ['Easy','Medium','Hard'])f.elements[d].checked=c.allowedDifficulties.includes(d);
  const platform=$('#platform-form');platform.elements.type.value=c.platform.type;platform.elements.baseUrl.value=c.platform.baseUrl;platform.elements.ownedSolutionStyle.value=c.ownedSolutionStyle;
  const healthLabel=(p)=>{const health=state.providerHealth?.[p],blocked=state.disabledProviders?.[p],kind=blocked?.kind||health?.status;if(!state.providers[p].configured)return'Not configured';if(kind==='key')return'Invalid key';if(kind==='quota')return'Quota exhausted';if(kind==='rate')return'Rate limited';if(kind==='temporary'||kind==='request')return'Needs attention';return health?.status==='working'?'Working':'Key saved · Untested';};
  $('#provider-cards').innerHTML=['groq','gemini'].map(p=>`<form class="card provider-form" data-provider="${p}"><div class="provider-top"><h2>${p==='groq'?'Groq':'Gemini'}</h2>${pill(healthLabel(p),/Invalid|Quota|Needs|Rate/.test(healthLabel(p))?'error':'')}</div>${state.disabledProviders?.[p]||state.providerHealth?.[p]?.reason?`<p class="error-text">${esc(state.disabledProviders?.[p]?.reason||state.providerHealth[p].reason)}</p>`:''}<div class="provider-actions"><label>Model<input name="model" value="${esc(c.models[p])}" required></label><label>API key<input name="key" type="password" autocomplete="off" placeholder="${state.providers[p].configured?'Saved securely — enter a replacement':'Paste API key'}"></label><button class="primary">Save</button><button type="button" class="quiet" data-test-provider="${p}">Test connection</button><button type="button" class="quiet" data-delete-provider="${p}">Delete key</button></div><small>${state.providerHealth?.[p]?.checkedAt?`Last checked ${esc(formatDate(state.providerHealth[p].checkedAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}. `:''}Testing makes a small API call.</small></form>`).join('');
  const activity=state.providerActivity;
  $('#provider-fallback').textContent=activity?activity.fallbackFrom?`Last solution used ${activity.provider} after ${activity.fallbackFrom} failed (${formatDate(activity.at,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}).`:`Last solution used ${activity.provider} (${formatDate(activity.at,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}).`:'No provider has generated a solution yet.';
}
function liveStreak(){const dates=new Set(Object.values(leetcodeRuns).filter(r=>r.mode!=='manual'&&['prepared','completed'].includes(r.status)&&r.username?.toLowerCase()===leetcodeAccount.toLowerCase()).map(r=>r.date));let date=state.today,count=0;if(!dates.has(date))date=previous(date);while(dates.has(date)){count++;date=previous(date);}return count;}
async function refresh(){if(!connection||busy)return;try{state=await api('state');if(extension){const local=await chrome.storage.local.get(['leetcodeRuns','leetcodeContests','contestCalendarUpdatedAt','contestCalendarError','leetcodeAccount','dailyDiagnostic']);leetcodeRuns=local.leetcodeRuns||{};leetcodeContests=local.leetcodeContests||[];contestCalendarUpdatedAt=local.contestCalendarUpdatedAt||0;contestCalendarError=local.contestCalendarError||'';leetcodeAccount=local.leetcodeAccount||'';dailyDiagnostic=local.dailyDiagnostic||null;liveRun=leetcodeRuns[`automatic:${state.today}:${leetcodeAccount.toLowerCase()}`]||((leetcodeRuns[state.today]?.username?.toLowerCase()===leetcodeAccount.toLowerCase())?leetcodeRuns[state.today]:null);const running=await chrome.runtime.sendMessage({type:'leetcode-run-status'});activeRunId=running?.activeId||null;stopping=!!running?.stopping;}render();openRunFromHash();}catch(e){$('#connection-dot').classList.remove('online');$('#connection-status').textContent='Connection unavailable';toast(e.message);}}
let openedRunHash='';
function openRunFromHash(){if(!location.hash.startsWith('#run=')||openedRunHash===location.hash)return;let id;try{id=decodeURIComponent(location.hash.slice(5));}catch{return;}const card=[...document.querySelectorAll('#history [data-run-id]')].find(item=>item.dataset.runId===id);if(!card)return;openedRunHash=location.hash;document.querySelector('nav [data-page="history"]')?.click();requestAnimationFrame(()=>card.scrollIntoView({behavior:'smooth',block:'start'}));}
async function action(fn){if(busy)return;busy=true;try{await fn();document.activeElement?.blur();toast('Saved');}catch(e){toast(e.message);}finally{busy=false;await refresh();}}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!=='page-'+page);document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));$('#breadcrumb').textContent='WORKSPACE / '+page.toUpperCase();}));
$('#connect-form').addEventListener('submit',async e=>{
  e.preventDefault();const url=$('#server-url').value.replace(/\/$/,'');const parsed=new URL(url);
  if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname)){toast('Use HTTPS for a cloud server.');return;}
  if(extension&&parsed.protocol==='https:'){const allowed=await chrome.permissions.request({origins:[parsed.origin+'/*']});if(!allowed){toast('Server permission was not granted');return;}}
  connection={url,token:$('#connection-token').value.trim()};
  try{state=await api('state');await saveConnection(connection);catalog=await api('catalog');populateCatalog();render();$('#connection-token').value='';if(extension)chrome.runtime.sendMessage({type:'poll'});}catch(err){toast(err.message);}
});
function populateCatalog(){const select=$('#contest-questions');if(select)select.innerHTML=catalog.map(p=>`<option value="${esc(p.id)}">${esc(p.title)} — ${esc(p.difficulty)}</option>`).join('');}
$('#refresh').addEventListener('click',refresh);
$('#manual-count').addEventListener('input',()=>{$('#manual-count').value=getManualCount();$('#run-now').textContent=`▶ Prepare ${getManualCount()} now`;if(extension)chrome.storage.local.set({manualQuestionCount:getManualCount()});});
$('#run-now').addEventListener('click',async()=>{
  if(busy)return;
  if(!state.config.leetcode?.enabled){await action(()=>api('run',{}));return;}
  if(!extension){toast('Open the Brave extension to solve LeetCode questions');return;}
  $('#run-now').disabled=true;
  const count=getManualCount();
  try{const result=await chrome.runtime.sendMessage({type:'run-leetcode-now',count});if(!result?.ok)throw Error(result?.error||'Could not start');toast(result.started?`Preparing ${count} new practice drafts`:result.reason||'A session is already running');}catch(error){toast(error.message);}finally{await refresh();}
});
$('#retry-daily').addEventListener('click',async()=>{
  const button=$('#retry-daily');button.disabled=true;
  try{const result=await chrome.runtime.sendMessage({type:'retry-leetcode-today'});if(!result?.ok)throw Error(result?.error||'Could not retry');toast('Preparing today’s drafts again for '+leetcodeAccount);}catch(error){toast(error.message);}finally{button.disabled=false;await refresh();}
});
$('#stop-solving').addEventListener('click',async()=>{
  $('#stop-solving').disabled=true;
  try{const result=await chrome.runtime.sendMessage({type:'stop-leetcode'});if(!result?.ok)throw Error(result?.error||'Could not stop');toast(result.stopped?'Stop requested. No further drafts will be generated.':'No session is running');}catch(error){toast(error.message);}finally{await refresh();}
});
$('#refresh-plan').addEventListener('click',()=>action(()=>api('plan',{})));
$('#refresh-contests').addEventListener('click',async()=>{if(!extension){toast('Open the Brave extension to refresh contests');return;}try{const result=await chrome.runtime.sendMessage({type:'refresh-leetcode-contests'});if(!result?.ok)throw Error(result?.error||'Contest refresh failed');toast('LeetCode contest timetable refreshed');await refresh();}catch(error){toast(error.message);}});
$('#settings-form').addEventListener('submit',e=>{
  e.preventDefault();
  const f=e.currentTarget,previousTime=state.config.dailyStartTime,previousTimezone=state.config.timezone;
  action(async()=>{
    await api('config',{dailyStartTime:f.elements.dailyStartTime.value,timezone:f.elements.timezone.value,dailyQuestionCount:Number(f.elements.dailyQuestionCount.value),language:f.elements.language.value,maxAttempts:Number(f.elements.maxAttempts.value),dailyTokenBudget:Number(f.elements.dailyTokenBudget.value),providerOrder:f.elements.providerOrder.value.split(','),autoMode:f.elements.autoMode.checked,preferQuestionOfTheDay:true,allowedDifficulties:['Easy','Medium','Hard'].filter(d=>f.elements[d].checked),notificationWebhook:f.elements.notificationWebhook.value,leetcode:{enforceUsername:false}});
    if(!extension)return;
    const scheduleChanged=previousTime!==f.elements.dailyStartTime.value||previousTimezone!==f.elements.timezone.value;
    if(scheduleChanged){
      const local=await chrome.storage.local.get('leetcodeRuns'),runs=local.leetcodeRuns||{},old=liveRun;
      if(old?.mode==='automatic'&&!['completed','discovering','running','stopping'].includes(old.status)){
        const archiveId=`automatic-history:${state.today}:${crypto.randomUUID()}`;
        runs[archiveId]={...old,id:archiveId};delete runs[old.id];
        await chrome.storage.local.set({leetcodeRuns:runs});
      }
    }
    let updated;
    try{updated=await chrome.runtime.sendMessage({type:'daily-schedule-updated',previousTime,previousTimezone});}catch{}
    if(!updated?.ok){
      const fallback=await chrome.runtime.sendMessage({type:'poll'}).catch(()=>null);
      if(fallback&&fallback.ok===false)throw Error(fallback.error||'Could not refresh the daily schedule');
    }
  });
});
$('#provider-cards').addEventListener('submit',e=>{e.preventDefault();const f=e.target,p=f.dataset.provider;action(async()=>{await api('config',{models:{[p]:f.elements.model.value}});if(f.elements.key.value)await api('keys',{provider:p,key:f.elements.key.value});f.elements.key.value='';f.elements.model.blur();});});
$('#provider-cards').addEventListener('click',e=>{const p=e.target.dataset.testProvider,d=e.target.dataset.deleteProvider;if(p)action(async()=>{const form=e.target.closest('form');await api('config',{models:{[p]:form.elements.model.value}});const r=await api('provider-test',{provider:p});toast(r.message);});if(d)action(()=>api('keys',{provider:d,key:''}));});
$('#platform-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;action(async()=>{if(f.elements.key.value)await api('keys',{provider:'platform',key:f.elements.key.value});await api('config',{ownedSolutionStyle:f.elements.ownedSolutionStyle.value,platform:{type:f.elements.type.value,baseUrl:f.elements.baseUrl.value}});f.elements.key.value='';catalog=await api('catalog');populateCatalog();});});
$('#history').addEventListener('click',e=>{if(e.target.dataset.retry)action(()=>api('retry',{id:e.target.dataset.retry}));});
$('#disconnect').addEventListener('click',async()=>{await saveConnection(null);connection=null;$('#workspace').hidden=true;$('#connect-panel').hidden=false;$('#connection-dot').classList.remove('online');$('#connection-status').textContent='Not connected';});
async function init(){connection=await loadConnection();if(!extension)$('#server-url').value=location.origin;else{const{manualQuestionCount=2}=await chrome.storage.local.get('manualQuestionCount');$('#manual-count').value=Math.max(1,Math.min(100,Number(manualQuestionCount)||2));}if(connection){try{catalog=await api('catalog');populateCatalog();await refresh();}catch(e){toast(e.message);}}if(location.hash==='#contests')document.querySelector('nav [data-page="contests"]')?.click();setInterval(refresh,5000);if(extension)chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.leetcodeRuns||changes.leetcodeContests))refresh();});}
init();
