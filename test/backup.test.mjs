import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {exportBackup,validateBackup,restoreBackup,supportReport} from '../server/backup.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'practice-backup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Store(dir);}
test('portable backups omit credentials and sensitive configuration URLs',t=>{
  const s=fixture(t);s.setSecret('gemini','private-provider-key');s.state.config.notificationWebhook='https://secret.example/token';s.state.config.platform.baseUrl='https://user:pass@platform.example/api?key=hidden';
  const data=exportBackup(s),text=JSON.stringify(data);
  for(const value of ['private-provider-key',s.state.adminToken,'secret.example','user:pass','key=hidden'])assert.ok(!text.includes(value));
  assert.equal(data.config.platform.baseUrl,'https://platform.example/api');
});
test('restore validates before writing, merges history and preserves current credentials',t=>{
  const s=fixture(t);s.setSecret('gemini','existing-key');const token=s.state.adminToken;
  const backup=exportBackup(s);backup.config.autoMode=true;backup.config.dailyQuestionCount=3;
  backup.jobs=[{id:'old',status:'running',tasks:[{status:'solving',problem:{id:'two-sum'}}]}];
  restoreBackup(s,backup);assert.equal(s.state.config.autoMode,false);assert.equal(s.state.jobs[0].status,'stopped');assert.equal(s.secret('gemini'),'existing-key');assert.equal(s.state.adminToken,token);
  const count=s.state.jobs.length;restoreBackup(s,backup);assert.equal(s.state.jobs.length,count);
  const invalid=structuredClone(backup);invalid.config.dailyQuestionCount=1000;
  assert.throws(()=>restoreBackup(s,invalid));assert.equal(s.state.config.dailyQuestionCount,3);
});
test('extension history rejects prototype identifiers and pauses imported active work',t=>{
  const s=fixture(t),backup=exportBackup(s);
  backup.extensionRuns=JSON.parse('{"__proto__":{"date":"2026-10-28","status":"completed","tasks":[]}}');assert.throws(()=>validateBackup(backup,s.state.config));
  backup.extensionRuns={run:{date:'2026-10-28',status:'running',tasks:[{status:'drafting',problem:{title:'Two Sum',titleSlug:'two-sum'}}]}};
  assert.equal(validateBackup(backup,s.state.config).extensionRuns.run.status,'stopped');
});
test('diagnostic export classifies failure without source code, account or raw error leakage',t=>{
  const s=fixture(t);s.state.notifications=[{kind:'error',createdAt:'2026-10-28',message:'API key private-123 invalid for account SecretPerson; code def private_code()'}];
  const text=JSON.stringify(supportReport(s,{version:'3.0.0',node:'22',platform:'darwin',checks:[{id:'server',ok:true,message:'secret-path'}]}));
  for(const value of ['private-123','SecretPerson','private_code','secret-path',s.state.adminToken])assert.ok(!text.includes(value));
  assert.match(text,/provider/);
});

test('restoring a backup cannot redirect saved provider or platform credentials',t=>{
  const s=fixture(t);s.setSecret('groq','private-groq');s.setSecret('platform','private-platform');
  const oldGroq=s.state.config.groqBaseUrl,oldPlatform=structuredClone(s.state.config.platform),backup=exportBackup(s);
  backup.config.groqBaseUrl='https://different.example/v1';backup.config.platform={type:'http',baseUrl:'https://different.example/api'};
  restoreBackup(s,backup);assert.equal(s.state.config.groqBaseUrl,oldGroq);assert.deepEqual(s.state.config.platform,oldPlatform);
});
