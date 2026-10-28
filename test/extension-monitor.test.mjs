import test from 'node:test';import assert from 'node:assert/strict';
import {recordHeartbeat,extensionHealth} from '../server/extension-monitor.mjs';
const row={instanceId:'fixture-profile',version:'3.3.1',status:'retrying',stage:'testing',accepted:0,target:2,reason:'rate',retryAt:'2026-10-28T10:00:00Z'};
test('heartbeats expose stale/version mismatches without persisting arbitrary credentials or code',()=>{
 const store={state:{},save(){}};recordHeartbeat(store,{...row,token:'private',code:'secret-code',reason:'API key private-value'},1000);
 const report=extensionHealth(store,'3.3.2',1000);assert.equal(report[0].fresh,true);assert.equal(report[0].versionMatches,false);assert.equal(report[0].reason,'none');
 const text=JSON.stringify(store.state);for(const word of ['private','secret-code','API key'])assert.ok(!text.includes(word));assert.equal(extensionHealth(store,'3.3.2',200000)[0].fresh,false);
 assert.throws(()=>recordHeartbeat(store,{...row,target:-1}),/Invalid/);
});
test('heartbeat retention is bounded and a new matching installed version becomes visible',()=>{
 const store={state:{},save(){}};for(let i=0;i<12;i++)recordHeartbeat(store,{...row,instanceId:'profile-'+i,version:'3.3.2'},1000+i);
 assert.equal(extensionHealth(store,'3.3.2',1100).length,8);assert.equal(extensionHealth(store,'3.3.2',1100).every(r=>r.versionMatches),true);
});
