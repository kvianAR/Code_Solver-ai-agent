const $=selector=>document.querySelector(selector);
const slugFromTab=tab=>{try{const url=new URL(tab?.url||'');return url.origin==='https://leetcode.com'?url.pathname.match(/^\/problems\/([a-z0-9-]+)(?:\/|$)/)?.[1]||'':'';}catch{return '';}};
const titleFromSlug=slug=>slug.split('-').map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' ');
const localDate=(date,timeZone)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const countAccepted=run=>(run?.tasks||[]).filter(task=>task.status==='accepted').length;
let busy=false;
function setMessage(message,success=false){$('#message').textContent=message||'';$('#message').classList.toggle('success',success);}
async function refresh(){
  const [{connection,lastConnected=0,lastState,leetcodeRuns={},leetcodeAccount=''},[tab],live]=await Promise.all([
    chrome.storage.local.get(['connection','lastConnected','lastState','leetcodeRuns','leetcodeAccount']),
    chrome.tabs.query({active:true,currentWindow:true}),
    chrome.runtime.sendMessage({type:'leetcode-run-status'}).catch(()=>({}))
  ]);
  const connected=!!connection&&Date.now()-lastConnected<3*60000;
  const badge=$('#connection');badge.textContent=connected?'Connected':connection?'Agent offline':'Setup needed';badge.className='connection '+(connected?'online':'offline');
  const config=lastState?.config||{},zone=config.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  const today=lastState?.today||localDate(new Date(),zone),target=Number(config.dailyQuestionCount)||2;
  const account=leetcodeAccount||'';
  const runs=Object.values(leetcodeRuns).filter(run=>account&&run.username?.toLowerCase()===account.toLowerCase());
  const daily=runs.find(run=>run.mode==='automatic'&&run.date===today);
  const accepted=countAccepted(daily);
  $('#account').textContent=account?`Signed in: ${account}`:'LeetCode login needed';
  $('#today-progress').textContent=`${accepted}/${target}`;
  $('#ring').style.setProperty('--progress',`${Math.min(100,Math.round(accepted/target*100))}%`);
  $('#run-status').textContent=live?.activeId?'Solving now':daily?.status?daily.status.charAt(0).toUpperCase()+daily.status.slice(1):config.autoMode?'Scheduled':'Auto Mode paused';
  $('#schedule').textContent=config.dailyStartTime?`Daily at ${config.dailyStartTime} · ${zone}`:'Set a daily time in dashboard';
  let streak=0,day=new Date(`${today}T12:00:00Z`);
  const week=[];
  for(let i=6;i>=0;i--){const d=new Date(day.getTime()-i*86400000),key=localDate(d,zone),run=runs.find(item=>item.mode==='automatic'&&item.date===key),done=countAccepted(run),goal=Number(run?.target)||target;week.push({date:d,done,goal});}
  for(let i=week.length-1;i>=0;i--){if(week[i].done>=week[i].goal)streak++;else if(i!==week.length-1)break;}
  $('#streak').textContent=`${streak}-day streak`;
  $('#bars').replaceChildren(...week.map(item=>{const wrapper=document.createElement('div');wrapper.className='day';const bar=document.createElement('div');bar.className='bar '+(item.done>=item.goal?'done':item.done?'partial':'');bar.textContent=String(item.done);const label=document.createElement('small');label.textContent=new Intl.DateTimeFormat('en',{weekday:'short'}).format(item.date);wrapper.append(bar,label);return wrapper;}));
  const slug=slugFromTab(tab);
  $('#question').textContent=slug?titleFromSlug(slug):'Open a LeetCode question tab to solve it here.';
  $('#tab-kind').textContent=slug?'Ready':'No question';
  $('#solve').disabled=busy||!!live?.activeId||!slug||!connection;
  $('#stop').hidden=!live?.activeId;
  if(!connection)setMessage('Connect the agent from the full dashboard first.');
}
$('#solve').addEventListener('click',async()=>{busy=true;$('#solve').disabled=true;setMessage('Starting this question…',true);try{const result=await chrome.runtime.sendMessage({type:'solve-current-question'});if(!result?.ok)throw Error(result?.error||'Could not start');if(!result.started)throw Error(result.reason||'A session is already running');setMessage('Started. Progress appears here and in the dashboard.',true);}catch(error){setMessage(error.message);}finally{busy=false;await refresh();}});
$('#stop').addEventListener('click',async()=>{const result=await chrome.runtime.sendMessage({type:'stop-leetcode'});setMessage(result?.stopped?'Stopping current run…':'No run is active.',!!result?.stopped);await refresh();});
$('#dashboard').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.leetcodeRuns||changes.lastState||changes.leetcodeAccount))refresh().catch(error=>setMessage(error.message));});
refresh().catch(error=>setMessage(error.message));
setInterval(()=>refresh().catch(()=>{}),3000);
