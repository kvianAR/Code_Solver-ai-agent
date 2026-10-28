import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {Store} from './store.mjs';
import {Platform} from './platform.mjs';
import {dockerJudge} from './runner.mjs';
import {Agent} from './agent.mjs';
import {createServer} from './http.mjs';
import {providerOrder,providerAvailable} from './local-ai.mjs';
import {readinessTarget} from '../extension/leetcode-runner.js';
import {newPairingKey,writePairingFile} from './pairing.mjs';
const dir=process.env.DATA_DIR||fileURLToPath(new URL('../data',import.meta.url));
fs.mkdirSync(dir,{recursive:true,mode:0o700});
// Prevent two scheduler processes from executing the same persisted tasks.
const lock=path.join(dir,'agent.lock');
try {const pid=Number(fs.readFileSync(lock));if(pid!==process.pid){try{process.kill(pid,0);throw Error('An agent process is already running for this data directory');}catch(e){if(e.code!=='ESRCH')throw e;}}fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
const store=new Store(dir),platform=new Platform(store,dockerJudge),agent=new Agent(store,platform);
const pairingKey=newPairingKey(),server=createServer(store,platform,agent,{pairingKey});
const pairingFile=fileURLToPath(new URL('../extension/local-connection.json',import.meta.url));
const host=process.env.HOST||'127.0.0.1';
let port=Number(process.env.PORT||process.env.PREFERRED_PORT||8787);
server.on('error',error=>{
  if(error.code==='EADDRINUSE'&&!process.env.PORT&&port<8799){port++;server.listen(port,host);return;}
  console.error('Could not start the agent:',error.message);shutdown();
});
server.on('listening',()=>{
  const url=`http://127.0.0.1:${server.address().port}`;
  if(host==='127.0.0.1'||host==='localhost'){
    try{writePairingFile(pairingFile,url,pairingKey);}catch(error){console.error('Automatic extension pairing unavailable:',error.message);}
  }
  fs.writeFileSync(path.join(dir,'server.json'),JSON.stringify({url,pid:process.pid}),{mode:0o600});
  console.log(`Practice Ex. ready at ${url}. The unpacked extension connects automatically.`);
});
server.listen(port,host);
let browserLaunchDate='';
let awakeDate='';
function localClock(timezone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts().map(x=>[x.type,x.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
function wakeBrowserForLeetCode(){
  const config=store.state.config,clock=localClock(config.timezone);
  const target=readinessTarget(config),phase=target===clock.date&&clock.time>=config.dailyStartTime?'daily':'precheck',launchKey=target+':'+phase;
  if(process.platform!=='darwin'||!config.autoMode||!config.leetcode?.enabled||!target||browserLaunchDate===launchKey)return;
  if(phase==='daily'&&!providerOrder(config).some(provider=>providerAvailable(store,provider)))return;
  if(awakeDate!==clock.date){
    awakeDate=clock.date;
    execFile('/usr/bin/caffeinate',['-i','-u','-t','1800'],error=>{if(error)console.error('Could not keep the Mac awake for LeetCode:',error.message);});
  }
  browserLaunchDate=launchKey;
  // Launch the configured browser hidden so the extension can run without stealing focus or
  // opening a visible LeetCode page in the middle of the user's work.
  const browser=config.leetcode.browser==='brave'?'Brave Browser':'Google Chrome';
  execFile('/usr/bin/open',['-gja',browser],error=>{if(error)console.error(`Could not wake ${browser} for the daily LeetCode session:`,error.message);});
}
const timer=setInterval(()=>{agent.tick();wakeBrowserForLeetCode();},15000);agent.tick();wakeBrowserForLeetCode();
function shutdown(){clearInterval(timer);server.close();if(fs.existsSync(lock))fs.unlinkSync(lock);process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
