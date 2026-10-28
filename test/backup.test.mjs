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

test('new study records round-trip while active interviews are stopped and local credentials keep their endpoint',t=>{
  const s=fixture(t);s.setSecret('local','private-local-key');s.state.config.localAI.enabled=true;
  s.state.study={entries:[],attempts:[],assistance:{},interviews:[{id:'session-1',username:'Student',problem:{title:'Question',titleSlug:'question',statement:'Solve it',starterCode:'class Solution: pass'},status:'active',deadline:'2026-10-28T10:00:00Z',hintLimit:1,hintsUsed:0}]};
  const backup=exportBackup(s);backup.config.localAI.baseUrl='http://127.0.0.1:9999';
  const fresh=fixture(t);fresh.setSecret('local','existing-local-key');const previous=fresh.state.config.localAI.baseUrl;
  restoreBackup(fresh,backup);assert.equal(fresh.state.study.interviews[0].status,'cancelled');assert.equal(fresh.state.config.localAI.baseUrl,previous);assert.equal(fresh.secret('local'),'existing-local-key');
});

test('daily progress and revision recall survive backup merge without replacing newer local history',t=>{
  const s=fixture(t),date='2026-10-28';
  s.state.dailyProgress={[date]:{'account:student':{accepted:2,target:2,qotdAccepted:true}}};
  s.state.study={entries:[],attempts:[],interviews:[],assistance:{},revisions:[{id:'revision-1',entryId:'mistake-1',username:'Student',date,answer:'boundary',correct:true}]};
  const backup=exportBackup(s),fresh=fixture(t);restoreBackup(fresh,backup);
  assert.equal(fresh.state.dailyProgress[date]['account:student'].accepted,2);assert.equal(fresh.state.study.revisions.length,1);
  fresh.state.dailyProgress[date]['account:student'].accepted=3;restoreBackup(fresh,backup);assert.equal(fresh.state.dailyProgress[date]['account:student'].accepted,3);assert.equal(fresh.state.study.revisions.length,1);
  backup.dailyProgress[date]['account:student'].accepted=-1;assert.throws(()=>restoreBackup(fresh,backup),/Invalid daily progress/);
});
