import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {Store} from './store.mjs';
import {Platform} from './platform.mjs';
import {dockerJudge} from './runner.mjs';
import {Agent} from './agent.mjs';
import {createServer} from './http.mjs';
const dir=process.env.DATA_DIR||fileURLToPath(new URL('../data',import.meta.url));
fs.mkdirSync(dir,{recursive:true,mode:0o700});
// Prevent two scheduler processes from executing the same persisted tasks.
const lock=path.join(dir,'agent.lock');
try {const pid=Number(fs.readFileSync(lock));if(pid!==process.pid){try{process.kill(pid,0);throw Error('An agent process is already running for this data directory');}catch(e){if(e.code!=='ESRCH')throw e;}}fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
const store=new Store(dir),platform=new Platform(store,dockerJudge),agent=new Agent(store,platform);
const server=createServer(store,platform,agent);
server.listen(Number(process.env.PORT||8787),process.env.HOST||'127.0.0.1',()=>console.log('Solver agent listening. Use npm run token for the dashboard connection token.'));
let browserLaunchDate='';
let awakeDate='';
function localClock(timezone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts().map(x=>[x.type,x.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
function wakeBrowserForLeetCode(){
  const config=store.state.config,clock=localClock(config.timezone);
  if(process.platform!=='darwin'||!config.autoMode||!config.leetcode?.enabled||clock.time<config.dailyStartTime||browserLaunchDate===clock.date)return;
  if(awakeDate!==clock.date){
    awakeDate=clock.date;
    execFile('/usr/bin/caffeinate',['-i','-u','-t','1800'],error=>{if(error)console.error('Could not keep the Mac awake for LeetCode:',error.message);});
  }
  browserLaunchDate=clock.date;
  // Launch Brave hidden so the extension can run without stealing focus or
  // opening a visible LeetCode page in the middle of the user's work.
  execFile('/usr/bin/open',['-gja','Brave Browser'],error=>{if(error)console.error('Could not wake Brave for the daily LeetCode session:',error.message);});
}
const timer=setInterval(()=>{agent.tick();wakeBrowserForLeetCode();},15000);agent.tick();wakeBrowserForLeetCode();
function shutdown(){clearInterval(timer);server.close();if(fs.existsSync(lock))fs.unlinkSync(lock);process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
