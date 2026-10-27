import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url));
const label='com.practice-ex.'+crypto.createHash('sha256').update(root).digest('hex').slice(0,12);
const plist=path.join(os.homedir(),'Library','LaunchAgents',label+'.plist');
const domain=`gui/${process.getuid?.()}`;
const runtime=path.join(root,'data','server.json');
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
if(process.platform!=='darwin')throw Error('One-click background setup currently supports macOS. Use npm start on other systems.');
if(Number(process.versions.node.split('.')[0])<22)throw Error('Install Node.js 22 or newer first.');
if(process.argv.includes('--uninstall')){
  try{execFileSync('launchctl',['bootout',domain,plist],{stdio:'ignore'});}catch{}
  fs.rmSync(plist,{force:true});
  console.log('This checkout’s background server is off. Saved settings and history remain.');
  process.exit(0);
}
fs.mkdirSync(path.dirname(plist),{recursive:true});
fs.mkdirSync(path.join(root,'data'),{recursive:true,mode:0o700});
// Stop only the process recorded by this checkout; other installations remain separate.
const lock=path.join(root,'data','agent.lock');
try{execFileSync('launchctl',['bootout',domain,plist],{stdio:'ignore'});}catch{}
try{
  const pid=Number(fs.readFileSync(lock,'utf8'));
  const command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
  const cwd=execFileSync('lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'});
  if(command.includes('server/index.mjs')&&cwd.split('\n').includes('n'+root.replace(/\/$/,'')))process.kill(pid,'SIGTERM');
  else throw Error('Another process owns this checkout’s lock; close it before setup.');
}catch(error){if(!['ENOENT','ESRCH'].includes(error.code)&&error.status!==1)throw error;}
let preferred=8787;
try{preferred=Number(new URL(JSON.parse(fs.readFileSync(runtime)).url).port)||8787;}catch{}
fs.rmSync(runtime,{force:true});
const text=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(root,'server','index.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH||'/usr/local/bin:/usr/bin:/bin')}</string><key>PREFERRED_PORT</key><string>${preferred}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(root,'data','background.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(root,'data','background-error.log'))}</string>
</dict></plist>`;
fs.writeFileSync(plist,text,{mode:0o600});
execFileSync('plutil',['-lint',plist],{stdio:'ignore'});
execFileSync('launchctl',['bootstrap',domain,plist]);
let address;
for(let attempt=0;attempt<40;attempt++){
  await new Promise(resolve=>setTimeout(resolve,250));
  try{
    const saved=JSON.parse(fs.readFileSync(runtime));
    const response=await fetch(saved.url+'/health',{signal:AbortSignal.timeout(1000)});
    if(response.ok){address=saved.url;break;}
  }catch{}
}
if(!address)throw Error('Server did not become ready. Check data/background-error.log.');
console.log(`Practice Ex. runs in the background at ${address}. Reload the unpacked extension once; it pairs automatically.`);
console.log('It starts again when you log in. Sleep/wake scheduling remains a separate optional setup.');
