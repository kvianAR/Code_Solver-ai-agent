import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {retryTime,bridgeError} from '../extension/retry-policy.js';
const source=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'').replace('init().catch(()=>{});','')+'\nglobalThis.transport={sendLeetCodeMessage,leetcodeMessage,saveRun};';
function fixture(sendMessage){
 const saved={},alarms=[],injections=[];
 const chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,saved[key]])),set:async values=>Object.assign(saved,values),remove:async key=>delete saved[key]}},tabs:{get:async()=>({status:'complete'}),query:async()=>[{id:1,url:'https://leetcode.com/problems/two-sum/',status:'complete'}],sendMessage,onUpdated:{addListener(){},removeListener(){}}},scripting:{executeScript:async arg=>injections.push(arg)},alarms:{create:async(name,options)=>alarms.push({name,...options}),onAlarm:{addListener(){}}},notifications:{onClicked:{addListener(){}}},runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(){}}}};
 class Runner{async recover(){}}
 const context={chrome,LeetCodeRunner:Runner,retryTime,bridgeError,Date,URL,AbortSignal,setTimeout,clearTimeout,setInterval(){}};
 runInNewContext(source,context);return {...context.transport,saved,alarms,injections};
}
test('a closed message port never replays a possibly sent judged submission',async()=>{
 let sends=0;const f=fixture(async()=>{sends++;throw Error('The message port closed before a response was received.');});
 await assert.rejects(f.sendLeetCodeMessage({id:1},{type:'leetcode-submit'},()=>false),/message port closed/);
 assert.equal(sends,1);assert.equal(f.injections.length,0);
});
test('a missing bridge can be injected once before sending an operation',async()=>{
 let sends=0;const f=fixture(async()=>{if(++sends===1)throw Error('Could not establish connection. Receiving end does not exist.');return {ok:true};});
 assert.equal((await f.sendLeetCodeMessage({id:1},{type:'leetcode-session'},()=>false)).ok,true);assert.equal(f.injections.length,1);assert.equal(sends,2);
});
test('cooldowns persist across bridge calls and suppress another tab/request until the deadline',async()=>{
 let sends=0;const deadline=new Date(Date.now()+120000).toISOString();
 const f=fixture(async()=>{sends++;return {ok:false,kind:'rate',error:'Run Code unavailable (429)',retryAt:deadline,retryAfterProvided:true};});
 const result=await f.leetcodeMessage({type:'leetcode-preflight'});assert.equal(result.retryAt,deadline);assert.equal(f.saved.leetcodeCooldown.until,deadline);
 await assert.rejects(f.leetcodeMessage({type:'leetcode-submit'}),error=>error.kind==='rate'&&error.submissionSent===false&&error.retryAt===deadline);
 assert.equal(sends,1);assert.equal(f.alarms[0].when,Date.parse(deadline));
});
test('saving a retrying daily run schedules its exact resume even without a server connection',async()=>{
 const f=fixture(async()=>({ok:true})),deadline=new Date(Date.now()+60000).toISOString();
 await f.saveRun({id:'automatic:today:student',mode:'automatic',status:'retrying',nextRetryAt:deadline,tasks:[]});
 assert.equal(f.alarms[0].name,'retry-leetcode');assert.equal(f.alarms[0].when,Date.parse(deadline));
});
