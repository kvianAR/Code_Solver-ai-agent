import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const dryRun=process.argv.includes('--dry-run');
const cancel=process.argv.includes('--cancel');
const project=process.env.DAILY_SOLVER_PROJECT||path.resolve(new URL('..',import.meta.url).pathname);
const statePath=path.join(project,'data','state.json');
const eventsPath=process.env.DAILY_SOLVER_EVENTS_PATH||path.join(project,'data','mac-wake-events.json');

function fiveMinutesBefore(time){const[h,m]=time.split(':').map(Number),minutes=(h*60+m-5+1440)%1440;return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00`;}
function pmset(args){if(dryRun){console.log('/usr/bin/pmset '+args.map(x=>JSON.stringify(x)).join(' '));return '';}return execFileSync('/usr/bin/pmset',args,{encoding:'utf8'});}
function stamp(date){return `${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}/${String(date.getFullYear()).slice(-2)} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:00`;}
function localStamp(date){return stamp(new Date(date.getTime()-5*60000));}
function savedEvents(){try{return JSON.parse(fs.readFileSync(eventsPath,'utf8'));}catch{return {contests:[],retries:[]};}}
function retryWakes(startTime,now,completed={},target=2){
  const [hour,minute]=startTime.split(':').map(Number),events=[];
  for(let day=0;day<2;day++){
    const base=new Date(now.getFullYear(),now.getMonth(),now.getDate()+day,hour,minute);
    const date=`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
    if((completed[date]?.accepted||0)>=target)continue;
    for(let offset=1;offset<=23;offset++){
      const retry=new Date(base.getTime()+offset*3600000);
      if(retry.getDate()!==base.getDate())break;
      const wake=new Date(retry.getTime()-5*60000);
      if(wake<=now)continue;
      events.push({owner:`com.daily-solver.retry.${stamp(retry).replace(/\D/g,'')}`,stamp:stamp(wake)});
    }
  }
  return events;
}

if(cancel){
  pmset(['repeat','cancel']);
  const events=savedEvents();
  for(const event of [...(events.contests||[]),...(events.retries||[])]){try{pmset(['schedule','cancel','wakeorpoweron',event.stamp,event.owner]);}catch{}}
  if(!dryRun&&fs.existsSync(eventsPath))fs.unlinkSync(eventsPath);
  console.log('Daily Solver repeating and contest wake events cancelled.');
  process.exit(0);
}

if(!fs.existsSync(statePath))throw Error(`State file not found: ${statePath}`);
const state=JSON.parse(fs.readFileSync(statePath,'utf8')),config=state.config;
if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.dailyStartTime))throw Error('Invalid daily start time');
const systemZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoneClock=(zone,date)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(date);
if([new Date(),new Date(Date.now()+180*86400000)].some(d=>zoneClock(systemZone,d)!==zoneClock(config.timezone,d)))throw Error(`Mac timezone (${systemZone}) must match agent timezone (${config.timezone}) for scheduled wake`);

pmset(['repeat','wakeorpoweron','MTWRFSU',fiveMinutesBefore(config.dailyStartTime)]);
const previous=savedEvents(),retries=config.autoMode&&config.leetcode?.enabled?retryWakes(config.dailyStartTime,new Date(),state.leetcodeDailyCompletion,config.dailyQuestionCount):[];
const oldRetries=new Map((previous.retries||[]).map(event=>[event.owner,event]));
const newRetries=new Map(retries.map(event=>[event.owner,event]));
for(const event of oldRetries.values())if(newRetries.get(event.owner)?.stamp!==event.stamp)try{pmset(['schedule','cancel','wakeorpoweron',event.stamp,event.owner]);}catch{}
for(const event of newRetries.values())if(oldRetries.get(event.owner)?.stamp!==event.stamp)pmset(['schedule','wakeorpoweron',event.stamp,event.owner]);
if(!dryRun){fs.mkdirSync(path.dirname(eventsPath),{recursive:true});fs.writeFileSync(eventsPath,JSON.stringify({...previous,daily:fiveMinutesBefore(config.dailyStartTime),retries},null,2),{mode:0o600});}
const query=`query contestUpcomingContests { contestV2UpcomingContests { title titleSlug startTime duration } }`;
const response=await fetch('https://leetcode.com/graphql/',{method:'POST',headers:{'content-type':'application/json','user-agent':'Daily Solver Wake Helper/1.0','referer':'https://leetcode.com/contest/'},body:JSON.stringify({query})});
if(!response.ok)throw Error(`LeetCode contest calendar failed (${response.status})`);
const data=await response.json(),now=Date.now(),week=now+7*86400000,scheduled=[];
for(const contest of data.data?.contestV2UpcomingContests||[]){
  const start=new Date(contest.startTime*1000),owner=`com.daily-solver.contest.${contest.titleSlug}`,stamp=localStamp(start);
  if(start.getTime()<now||start.getTime()>week)continue;
  scheduled.push({owner,stamp,title:contest.title});
}
for(const event of previous.contests||[]){try{pmset(['schedule','cancel','wakeorpoweron',event.stamp,event.owner]);}catch{}}
for(const event of scheduled)pmset(['schedule','wakeorpoweron',event.stamp,event.owner]);
if(!dryRun){fs.mkdirSync(path.dirname(eventsPath),{recursive:true});fs.writeFileSync(eventsPath,JSON.stringify({daily:fiveMinutesBefore(config.dailyStartTime),retries,contests:scheduled},null,2),{mode:0o600});}
console.log(`Wake schedule refreshed: daily ${fiveMinutesBefore(config.dailyStartTime)}, ${retries.length} hourly retry wakes, contests from LeetCode for seven days.`);
