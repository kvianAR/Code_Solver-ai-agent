import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DEFAULT,validateConfig} from './config.mjs';
import '../extension/portable-data.js';
import '../extension/failure-guide.js';
const {clean,runs}=globalThis.portableData;
function safeConfig(config){
  const result=Object.fromEntries(Object.keys(DEFAULT).filter(k=>k!=='notificationWebhook'&&k in config).map(k=>[k,clean(config[k])]));
  if(result.platform?.baseUrl){try{const url=new URL(result.platform.baseUrl);url.username='';url.password='';url.search='';url.hash='';result.platform.baseUrl=url.href;}catch{result.platform.baseUrl='';}}
  return result;
}
export function exportBackup(store){return {format:'practice-ex.backup',schemaVersion:1,createdAt:new Date().toISOString(),config:safeConfig(store.state.config),jobs:clean(store.state.jobs),extensionRuns:{}};}
export function validateBackup(input,currentConfig){
  if(!input||input.format!=='practice-ex.backup'||input.schemaVersion!==1||!input.config||!Array.isArray(input.jobs)||input.jobs.length>1000)throw Error('Unsupported or invalid backup');
  const config=validateConfig({...currentConfig,...safeConfig(input.config),autoMode:false});
  const jobs=clean(input.jobs);
  for(const job of jobs){
    if(typeof job.id!=='string'||job.id.length>200||!Array.isArray(job.tasks)||job.tasks.length>100)throw Error('Invalid job in backup');
    for(const task of job.tasks)if(!task.problem||typeof task.problem.id!=='string'||typeof task.status!=='string')throw Error('Invalid job task in backup');
    if(['running','queued'].includes(job.status)){job.status='stopped';for(const task of job.tasks)if(!['accepted','failed','blocked'].includes(task.status))task.status='stopped';}
  }
  return {config,jobs,extensionRuns:runs(input.extensionRuns||{})};
}
export function restoreBackup(store,input){
  const prepared=validateBackup(input,store.state.config);
  // A backup cannot redirect credentials already saved on this machine.
  if(store.secret('groq'))prepared.config.groqBaseUrl=store.state.config.groqBaseUrl;
  if(store.secret('platform'))prepared.config.platform=structuredClone(store.state.config.platform);
  const directory=path.join(store.dir,'restore-backups');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  // This local recovery snapshot is private; exportBackup never includes credentials.
  const file=path.join(directory,Date.now()+'-'+crypto.randomUUID()+'.json');
  fs.writeFileSync(file,JSON.stringify(exportBackup(store)),{mode:0o600});
  const existing=new Set(store.state.jobs.map(j=>j.id));
  store.state.jobs.push(...prepared.jobs.filter(j=>!existing.has(j.id)));
  store.state.config=prepared.config;store.state.providerHealth={};store.state.disabledProviders={};store.save();
  return {ok:true,extensionRuns:prepared.extensionRuns,message:'History merged. Existing runs and credentials kept. Auto Mode is paused.'};
}
export function supportReport(store,diagnostics){
  return {format:'practice-ex.diagnostics',schemaVersion:1,createdAt:new Date().toISOString(),version:diagnostics.version,node:diagnostics.node,platform:diagnostics.platform,
    checks:diagnostics.checks.map(c=>({id:c.id,ok:!!c.ok})),
    providers:Object.fromEntries(['groq','gemini'].map(p=>[p,{configured:!!store.secret(p),status:store.state.providerHealth[p]?.status||'untested'}])),
    recentFailures:store.state.notifications.filter(n=>n.kind==='error').slice(0,10).map(n=>({at:n.createdAt,...globalThis.failureGuide.explain(n.message)}))};
}
