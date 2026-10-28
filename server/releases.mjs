import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const roots=['extension','server','scripts','test','docs'];
const files=['Start Practice Ex.command','package.json','config.json','compatibility.json','README.md','CHANGELOG.md','LICENSE','CONTRIBUTING.md','Dockerfile','compose.yaml','.gitignore','.dockerignore'];
const allowed=name=>name==='AGENTS.md'||roots.some(root=>name===root+'/'||name.startsWith(root+'/'))||files.includes(name);
export function inspectZip(buffer){
  if(buffer.length>50e6)throw Error('Release exceeds 50 MB');
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
  if(end<0||buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0)throw Error('Invalid or multi-volume ZIP');
  const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16),size=buffer.readUInt32LE(end+12);
  if(!count||count>2000||offset+size!==end)throw Error('Unsupported release archive');
  let cursor=offset,total=0;const names=new Set();
  for(let i=0;i<count;i++){
    if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50)throw Error('Invalid ZIP directory');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),length=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32);
    if(cursor+46+length+extra+comment>end)throw Error('Invalid ZIP entry');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(cursor+46,cursor+46+length));
    const mode=(buffer.readUInt32LE(cursor+38)>>>16)&0xf000,local=buffer.readUInt32LE(cursor+42);
    if(flags&1||![0,8].includes(method)||![0,0x4000,0x8000].includes(mode)||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.split('/').some((p,i,parts)=>p==='..'||p==='.'||!p&&i<parts.length-1)||!allowed(name)||names.has(name)||/local-connection\.json|(^|\/)\.env($|\.)|vault\.key/.test(name))throw Error('Unsafe release entry');
    if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50)throw Error('Invalid local ZIP entry');
    const localName=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28);
    if(local+30+localName+localExtra+buffer.readUInt32LE(cursor+20)>offset||buffer.subarray(local+30,local+30+localName).toString('utf8')!==name)throw Error('Inconsistent ZIP entry');
    total+=buffer.readUInt32LE(cursor+24);if(total>200e6)throw Error('Expanded release exceeds 200 MB');
    names.add(name);cursor+=46+length+extra+comment;
  }
  if(cursor!==end||!['package.json','extension/manifest.json','server/index.mjs','scripts/setup.mjs','config.json'].every(name=>names.has(name)))throw Error('Incomplete release archive');
  return names;
}
export function checkCompatibility(pkg,manifest,compatibility={apiVersion:1,minNodeMajor:22}){
  if(pkg.name!=='leetcode-ai-agent'||!/^\d+\.\d+\.\d+$/.test(pkg.version||'')||pkg.version!==manifest.version)throw Error('Package and extension versions must match');
  if(compatibility.apiVersion!==1||!Number.isInteger(compatibility.minNodeMajor)||Number(process.versions.node.split('.')[0])<compatibility.minNodeMajor)throw Error('Release requires a different runtime or API version');
  if(pkg.engines?.node){const minimum=/^>=\s*(\d+)(?:\.\d+){0,2}$/.exec(pkg.engines.node);if(!minimum||Number(minimum[1])>Number(process.versions.node.split('.')[0]))throw Error('Unsupported Node.js version requirement');}
  if(compatibility.backupSchema!==undefined&&compatibility.backupSchema!==1)throw Error('Unsupported backup schema');
  return pkg.version;
}
export function validateArchive(file){
  const names=inspectZip(fs.readFileSync(file));
  execFileSync('unzip',['-tq',file],{timeout:10000,maxBuffer:1e6});
  const read=name=>JSON.parse(execFileSync('unzip',['-p',file,name],{maxBuffer:1e6,timeout:5000}));
  const version=checkCompatibility(read('package.json'),read('extension/manifest.json'),names.has('compatibility.json')?read('compatibility.json'):undefined);
  return {version,files:names.size};
}
export function prepareRelease(store,buffer){
  inspectZip(buffer);
  const dir=path.join(store.dir,'pending-updates');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const id=crypto.randomUUID(),file=path.join(dir,id+'.zip');fs.writeFileSync(file,buffer,{mode:0o600});
  try{const info=validateArchive(file);fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({...info,sha256:crypto.createHash('sha256').update(buffer).digest('hex')}),{mode:0o600});return {id,...info};}
  catch(error){fs.rmSync(file,{force:true});throw error;}
}
function copyCode(from,to){
  fs.mkdirSync(to,{recursive:true,mode:0o700});
  for(const name of [...roots,...files]){
    const source=path.join(from,name);if(!fs.existsSync(source))continue;
    fs.cpSync(source,path.join(to,name),{recursive:true,filter:file=>!path.basename(file).startsWith('local-connection.json')});
  }
  if(fs.existsSync(path.join(from,'AGENTS.md'))&&!fs.existsSync(path.join(to,'AGENTS.md')))fs.copyFileSync(path.join(from,'AGENTS.md'),path.join(to,'AGENTS.md'));
}
function replaceCode(from,to){
  for(const name of [...roots,...files])fs.rmSync(path.join(to,name),{recursive:true,force:true});
  copyCode(from,to);
}
function snapshot(root){
  const id=crypto.randomUUID(),dir=path.join(root,'data','update-backups',id);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});copyCode(root,path.join(dir,'code'));
  for(const file of ['state.json','vault.key'])if(fs.existsSync(path.join(root,'data',file)))fs.copyFileSync(path.join(root,'data',file),path.join(dir,file));
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
  fs.writeFileSync(path.join(dir,'metadata.json'),JSON.stringify({id,version,createdAt:new Date().toISOString()}),{mode:0o600});
  return {id,dir,version};
}
export function listSnapshots(dataDir){
  const folder=path.join(dataDir,'update-backups');if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).flatMap(id=>{try{return [JSON.parse(fs.readFileSync(path.join(folder,id,'metadata.json')))];}catch{return [];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function stop(root){
  execFileSync(process.execPath,[path.join(root,'scripts','setup.mjs'),'--uninstall'],{timeout:15000,stdio:'pipe'});
  const lock=path.join(root,'data','agent.lock');
  if(fs.existsSync(lock)){
    const pid=Number(fs.readFileSync(lock));
    try{
      const cwd=execFileSync('lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'});
      if(!cwd.split('\n').includes('n'+root.replace(/\/$/,'')))throw Error('A different process owns the agent lock');
      process.kill(pid,'SIGTERM');
    }catch(error){if(error.code!=='ESRCH'&&error.status!==1)throw error;}
  }
}
const start=root=>execFileSync(process.execPath,[path.join(root,'scripts','setup.mjs')],{timeout:30000,maxBuffer:1e6});
function status(root,phase,info={}){fs.mkdirSync(path.join(root,'data'),{recursive:true,mode:0o700});fs.writeFileSync(path.join(root,'data','update-status.json'),JSON.stringify({phase,...info,at:new Date().toISOString()}),{mode:0o600});}
export function applyArchive(root,file,{manageService=true}={}){
  if(manageService&&process.platform!=='darwin')throw Error('Managed release installation currently supports macOS only');
  const info=validateArchive(file),stage=fs.mkdtempSync(path.join(root,'data','release-stage-'));
  let saved,mutated=false;
  try{
    execFileSync('unzip',['-q',file,'-d',stage],{timeout:15000});
    saved=snapshot(root);status(root,'installing',{version:info.version,rollbackId:saved.id});
    if(manageService)stop(root);
    mutated=true;replaceCode(stage,root);
    if(manageService)start(root);
    status(root,'complete',{version:info.version,rollbackId:saved.id});return {version:info.version,rollbackId:saved.id};
  }catch(error){
    if(mutated&&saved){replaceCode(path.join(saved.dir,'code'),root);if(manageService)start(root);}
    status(root,mutated?'rolled-back':'failed',{version:saved?.version});throw error;
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
export function applyRollback(root,id,{manageService=true}={}){
  if(manageService&&process.platform!=='darwin')throw Error('Managed code rollback currently supports macOS only');
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid rollback id');
  const source=path.join(root,'data','update-backups',id,'code');
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'))),manifest=JSON.parse(fs.readFileSync(path.join(source,'extension','manifest.json')));
  const compatFile=path.join(source,'compatibility.json');
  checkCompatibility(pkg,manifest,fs.existsSync(compatFile)?JSON.parse(fs.readFileSync(compatFile)):undefined);
  const saved=snapshot(root);
  try{if(manageService)stop(root);replaceCode(source,root);if(manageService)start(root);status(root,'complete',{version:pkg.version,rollbackId:saved.id});return {version:pkg.version,rollbackId:saved.id};}
  catch(error){replaceCode(path.join(saved.dir,'code'),root);if(manageService)start(root);status(root,'rolled-back',{version:saved.version});throw error;}
}
export function launchUpdate(store,id,rollback=false){
  const root=fileURLToPath(new URL('..',import.meta.url));
  if(process.platform!=='darwin'||path.resolve(store.dir)!==path.join(root,'data'))throw Error('Managed updates require macOS and the default project data directory');
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid update id');
  let args;
  if(rollback){if(!listSnapshots(store.dir).some(row=>row.id===id))throw Error('Rollback not found');args=['--rollback',id];}
  else{
    const folder=path.join(store.dir,'pending-updates'),file=path.join(folder,id+'.zip');
    const prepared=JSON.parse(fs.readFileSync(path.join(folder,id+'.json')));
    if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==prepared.sha256)throw Error('Prepared release changed; select it again');
    validateArchive(file);args=['--archive',file];
  }
  const lock=path.join(store.dir,'update.lock'),nonce=crypto.randomUUID();
  try{fs.writeFileSync(lock,nonce,{flag:'wx',mode:0o600});}catch{throw Error('An update is already in progress');}
  status(root,'queued');
  setTimeout(()=>{
    const log=fs.openSync(path.join(store.dir,'update.log'),'a',0o600);
    const child=spawn(process.execPath,[path.join(root,'scripts','update.mjs'),...args,'--lock',nonce],{cwd:root,detached:true,stdio:['ignore',log,log]});
    child.on('error',()=>{fs.rmSync(lock,{force:true});status(root,'failed');});child.unref();fs.closeSync(log);
  },250);
}
