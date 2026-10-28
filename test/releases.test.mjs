import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {inspectZip,validateArchive,applyArchive,applyRollback,listSnapshots,checkCompatibility,verifyUpdatedService} from '../server/releases.mjs';
function tree(root,version){
  for(const folder of ['data','extension','server','scripts'])fs.mkdirSync(path.join(root,folder),{recursive:true});
  for(const [file,value] of Object.entries({'package.json':JSON.stringify({name:'leetcode-ai-agent',version}),'extension/manifest.json':JSON.stringify({version}),'server/index.mjs':'// version '+version,'scripts/setup.mjs':'// fixture setup','config.json':'{}'}))fs.writeFileSync(path.join(root,file),value);
}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'practice-release-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'installed'),source=path.join(dir,'release'),archive=path.join(dir,'release.zip');tree(root,'2.9.0');tree(source,'3.0.0');execFileSync('zip',['-qr',archive,'package.json','config.json','extension','server','scripts'],{cwd:source});return {dir,root,source,archive};}
test('checked update and code rollback preserve runtime history and credentials',t=>{
  const {root,archive}=fixture(t),state=path.join(root,'data','state.json');fs.writeFileSync(state,'private-current-history');fs.writeFileSync(path.join(root,'AGENTS.md'),'Keep the complete daily allotment mandatory.');
  const installed=applyArchive(root,archive,{manageService:false});
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'3.0.0');assert.equal(fs.readFileSync(state,'utf8'),'private-current-history');
  fs.writeFileSync(state,'history-recorded-after-update');
  const restored=applyRollback(root,installed.rollbackId,{manageService:false});
  assert.equal(restored.version,'2.9.0');assert.equal(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),'Keep the complete daily allotment mandatory.');assert.equal(fs.readFileSync(state,'utf8'),'history-recorded-after-update');assert.equal(listSnapshots(path.join(root,'data')).length,2);
});
test('an install copy failure restores the previous code automatically',t=>{
  const {root,archive}=fixture(t),original=fs.cpSync;let failed=false;
  fs.cpSync=function(from,to,options){if(!failed&&from.includes('release-stage-')){failed=true;throw Error('Simulated disk write failure');}return original(from,to,options);};
  try{assert.throws(()=>applyArchive(root,archive,{manageService:false}),/Simulated disk/);}finally{fs.cpSync=original;}
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'2.9.0');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data','update-status.json'))).phase,'rolled-back');
});
test('ZIP validation rejects traversal, symlinks and private pairing data before extraction',t=>{
  const {dir}=fixture(t);
  for(const [name,symlink] of [['../outside',false],['server/link',true],['extension/local-connection.json',false]]){
    const archive=path.join(dir,'unsafe.zip');
    execFileSync('python3',['-c','import zipfile,sys,stat\np,name,link=sys.argv[1:]\ni=zipfile.ZipInfo(name)\ni.create_system=3\ni.external_attr=((stat.S_IFLNK|0o777) if link=="yes" else (stat.S_IFREG|0o600))<<16\nwith zipfile.ZipFile(p,"w") as z:z.writestr(i,"private")',archive,name,symlink?'yes':'no']);
    assert.throws(()=>inspectZip(fs.readFileSync(archive)),/Unsafe release entry/);
  }
});
test('compatibility mismatches and damaged archives fail before an update',t=>{
  const {archive}=fixture(t);assert.equal(validateArchive(archive).version,'3.0.0');
  assert.throws(()=>checkCompatibility({name:'leetcode-ai-agent',version:'3.0.0'},{version:'2.9.0'}),/versions must match/);
  assert.throws(()=>checkCompatibility({name:'leetcode-ai-agent',version:'3.0.0'},{version:'3.0.0'},{apiVersion:2,minNodeMajor:22}),/runtime or API/);
  assert.throws(()=>inspectZip(Buffer.from('invalid')),/Invalid/);
});

test('broken source and missing dependencies are rejected before installed code is changed',t=>{
  const {root,source,archive}=fixture(t);
  for(const body of ['const = ;',"import './missing-file.mjs';"]){
    fs.writeFileSync(path.join(source,'server','index.mjs'),body);fs.rmSync(archive);execFileSync('zip',['-qr',archive,'package.json','config.json','extension','server','scripts'],{cwd:source});
    assert.throws(()=>applyArchive(root,archive,{manageService:false}),/syntax check failed|dependency missing/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'2.9.0');assert.equal(listSnapshots(path.join(root,'data')).length,0);
  }
});
test('a damaged installed copy triggers automatic code rollback after the restore point is saved',t=>{
  const {root,archive}=fixture(t),original=fs.cpSync;let damaged=false;
  fs.cpSync=function(from,to,options){const result=original(from,to,options);if(!damaged&&from.includes('release-stage-')&&from.endsWith('server')){damaged=true;fs.writeFileSync(path.join(to,'index.mjs'),'const = ;');}return result;};
  try{assert.throws(()=>applyArchive(root,archive,{manageService:false}),/syntax check failed/);}finally{fs.cpSync=original;}
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'2.9.0');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data','update-status.json'))).phase,'rolled-back');
});


test('post-update checks require authenticated API, matching version and working syntax service',async t=>{
  const {root}=fixture(t);
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import http from 'node:http';import fs from 'node:fs';
    const root=process.argv[1];
    const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer fixture-token'){res.writeHead(401);res.end('{}');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/state'?{serverVersion:'3.0.0',apiVersion:1,config:{}}:{checks:[{id:'syntax',ok:true}]}));});
    server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(root+'/data/server.json',JSON.stringify({url:'http://127.0.0.1:'+server.address().port}));process.stdout.write('ready\\n');});
  `,root],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Fixture server stopped: '+code)));});
  fs.writeFileSync(path.join(root,'data','state.json'),JSON.stringify({adminToken:'fixture-token'}));
  assert.doesNotThrow(()=>verifyUpdatedService(root,'3.0.0'));
  assert.throws(()=>verifyUpdatedService(root,'9.0.0'),/authenticated startup checks/);
  fs.writeFileSync(path.join(root,'data','state.json'),JSON.stringify({adminToken:'wrong-token'}));
  assert.throws(()=>verifyUpdatedService(root,'3.0.0'),/authenticated startup checks/);
});
