import {localClock,hasAcceptedQotd} from './leetcode-runner.js';

export function acceptedDailyTasks(runs,date,username){
  if(!username)return [];
  const tasks=new Map();
  for(const run of Object.values(runs))if(run.mode==='automatic'&&run.date===date&&run.username?.toLowerCase()===username.toLowerCase()){
    for(const task of run.tasks||[])if(task.status==='accepted'&&task.problem?.titleSlug){
      const old=tasks.get(task.problem.titleSlug);
      if(!old||task.problem.selection==='QOTD')tasks.set(task.problem.titleSlug,structuredClone(task));
    }
  }
  return [...tasks.values()].sort((a,b)=>Number(b.problem.selection==='QOTD')-Number(a.problem.selection==='QOTD'));
}
export function deadlineNotice(config,runs,username,diagnostic={},now=new Date()){
  if(!config.autoMode||!config.leetcode?.enabled||!username)return null;
  const clock=localClock(config.timezone,now),minutes=1440-Number(clock.time.slice(0,2))*60-Number(clock.time.slice(3));
  if(clock.time<config.dailyStartTime||minutes>60)return null;
  const tasks=acceptedDailyTasks(runs,clock.date,username),qotdPending=!hasAcceptedQotd({tasks}),remaining=Math.max(qotdPending?1:0,config.dailyQuestionCount-tasks.length);
  if(!remaining&&!qotdPending)return null;
  const level=minutes<=15?15:60;
  return {key:`${clock.date}:${username.toLowerCase()}:${level}`,date:clock.date,level,remaining,qotdPending,
    message:`${remaining} allotted questions still need acceptance${qotdPending?'; QOTD is pending':''}. ${minutes} minutes left in the local day. ${diagnostic.message||'Open the extension to check daily practice.'}`};
}
export function connectionHealth(saved,now=Date.now()){
  const c=saved.lastState?.config,session=saved.leetcodeSession,age=now-(saved.lastConnected||0),fresh=!!saved.connection&&age<180000;
  const ids=c?[...(c.localAI?.enabled&&!c.localAI.cloudFallback?[]:c.providerOrder||[]),...(c.localAI?.enabled?['local']:[])]:[];
  const ready=ids.filter(id=>saved.lastState?.providers?.[id]?.configured&&!saved.lastState?.disabledProviders?.[id]&&!(Date.parse(saved.lastState?.providerCooldowns?.[id]?.until)>now));
  return [
    {id:'extension',ok:true,message:'Extension background is responding'},
    {id:'server',ok:fresh,message:fresh?'Server heartbeat received':saved.autoConnectDisabled?'Automatic connection is paused':saved.autoConnectError||'Server heartbeat is stale; reconnecting on the next check'},
    {id:'login',ok:session?.status==='signed-in'&&now-Date.parse(session.checkedAt)<300000,message:session?.status==='signed-in'?`Last verified account: ${session.username}`:session?.error||'LeetCode login needs checking'},
    {id:'ai',ok:fresh&&ready.length>0,message:ready.length?`Configured providers available: ${ready.join(', ')}. Quota is not guaranteed.`:'No provider is ready; check models, keys and cooldowns'}
  ];
}
