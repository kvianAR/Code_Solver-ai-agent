import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {allowPairing,newPairingKey,writePairingFile} from '../server/pairing.mjs';
import {Store} from '../server/store.mjs';
import {Platform} from '../server/platform.mjs';
import {Agent} from '../server/agent.mjs';
import {createServer} from '../server/http.mjs';

test('pairing requires loopback, a local Host, a private key and an extension origin',()=>{
  const key=newPairingKey();
  const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:8790',origin:'chrome-extension://'+'a'.repeat(32),'x-practice-pairing':key}};
  assert.equal(allowPairing(request,key),true);
  for(const headers of [{origin:'https://evil.example'},{origin:'null'},{host:'evil.example'},{'x-practice-pairing':'wrong'}]){
    assert.equal(allowPairing({...request,headers:{...request.headers,...headers}},key),false);
  }
  assert.equal(allowPairing({...request,socket:{remoteAddress:'192.168.1.10'}},key),false);
  assert.equal(allowPairing(request,''),false);
});

test('private pairing file omits the admin token and is not an HTTP asset',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'practice-pairing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const key=newPairingKey(),file=path.join(dir,'local-connection.json');
  writePairingFile(file,'http://127.0.0.1:8790',key);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const store=new Store(dir),platform=new Platform(store,async()=>({accepted:true})),agent=new Agent(store,platform);
  assert.ok(!fs.readFileSync(file,'utf8').includes(store.state.adminToken));
  const server=createServer(store,platform,agent,{pairingKey:key});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/local-connection.json')).status,401);
  assert.equal((await fetch(url+'/api/extension-pair',{method:'POST'})).status,403);
  assert.equal((await fetch(url+'/api/extension-pair',{method:'POST',headers:{'X-Practice-Pairing':key,Origin:'https://evil.example'}})).status,403);
  const response=await fetch(url+'/api/extension-pair',{method:'POST',headers:{'X-Practice-Pairing':key,Origin:'chrome-extension://'+'a'.repeat(32)}});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal((await response.json()).token,store.state.adminToken);
});
