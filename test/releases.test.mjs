import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectZip,validateArchive,applyArchive,applyRollback,listSnapshots,checkCompatibility} from '../server/releases.mjs';
function tree(root,version){
  for(const folder of ['data','extension','server','scripts'])fs.mkdirSync(path.join(root,folder),{recursive:true});
  for(const [file,value] of Object.entries({'package.json':JSON.stringify({name:'leetcode-ai-agent',version}),'extension/manifest.json':JSON.stringify({version}),'server/index.mjs':'// version '+version,'scripts/setup.mjs':'// fixture setup','config.json':'{}'}))fs.writeFileSync(path.join(root,file),value);
}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'practice-release-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'installed'),source=path.join(dir,'release'),archive=path.join(dir,'release.zip');tree(root,'2.9.0');tree(source,'3.0.0');execFileSync('zip',['-qr',archive,'package.json','config.json','extension','server','scripts'],{cwd:source});return {dir,root,source,archive};}
test('checked update and code rollback preserve runtime history and credentials',t=>{
  const {root,archive}=fixture(t),state=path.join(root,'data','state.json');fs.writeFileSync(state,'private-current-history');
  const installed=applyArchive(root,archive,{manageService:false});
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'3.0.0');assert.equal(fs.readFileSync(state,'utf8'),'private-current-history');
  fs.writeFileSync(state,'history-recorded-after-update');
  const restored=applyRollback(root,installed.rollbackId,{manageService:false});
  assert.equal(restored.version,'2.9.0');assert.equal(fs.readFileSync(state,'utf8'),'history-recorded-after-update');assert.equal(listSnapshots(path.join(root,'data')).length,2);
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
