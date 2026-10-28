import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {retryTime,bridgeError} from '../extension/retry-policy.js';
const source=readFileSync(new URL('../extension/leetcode.js',import.meta.url),'utf8');
const now=Date.parse('2026-10-28T06:00:00Z');
const problem={titleSlug:'two-sum',id:'1',langSlug:'python3',exampleTestcases:'[2,7]\n9'};
const ok=value=>({ok:true,status:200,json:async()=>value});
const limited=(after='60')=>({ok:false,status:429,headers:{get:name=>name==='retry-after'?after:null}});
function bridge(handler,username='Student',start=now){
 let listener,clock=start;const requests=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const context={Date:Clock,setTimeout(callback,ms){clock+=ms||0;callback();},document:{cookie:'csrftoken=fixture'},chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}},sendMessage:async()=>({ok:true})}},fetch:async(url,options)=>{requests.push({url,at:clock,body:options?.body});return handler(url,options,requests);}};
 vm.runInNewContext(source,context);
 const send=(message={})=>new Promise(resolve=>listener({type:'leetcode-preflight',problem,code:'class Solution: pass',username,...message},null,resolve));
 return {send,requests};
}
test('Retry-After seconds and HTTP dates survive bridge serialization without rapid GraphQL retries',async()=>{
 for(const value of ['120','Wed, 28 Oct 2026 06:02:00 GMT']){
  const b=bridge(()=>limited(value));const response=await b.send({type:'leetcode-session'});
  assert.equal(response.ok,false);assert.equal(response.kind,'rate');assert.equal(response.retryAt,'2026-10-28T06:02:00.000Z');assert.equal(response.retryAfterProvided,true);assert.equal(b.requests.length,1);
  const error=bridgeError(response,'failed');assert.equal(error.kind,'rate');assert.equal(error.retryAt,response.retryAt);
 }
});
test('judge-result 429 resumes its saved run ID instead of posting Run Code twice, even in a fresh tab',async()=>{
 const first=bridge(url=>url==='/graphql/'?ok({data:{userStatus:{isSignedIn:true,username:'Student'}}}):url.includes('/interpret_solution/')?ok({interpret_id:'pending-run'}):limited('90'));
 const response=await first.send();assert.equal(response.kind,'rate');assert.equal(response.checkpoint.runId,'pending-run');assert.equal(response.checkpoint.stage,'examples');
 const second=bridge(url=>url==='/graphql/'?ok({data:{userStatus:{isSignedIn:true,username:'Student'}}}):url.includes('/pending-run/check/')?ok({state:'SUCCESS',run_success:true,correct_answer:true}):assert.fail('Run Code was reposted'),'Student',now+120000);
 const resumed=await second.send({problem:{...problem,preflightCheckpoint:response.checkpoint}});assert.equal(resumed.ok,true);assert.equal(resumed.value.ok,true);assert.equal(second.requests.some(r=>r.url.includes('interpret_solution')),false);
});
test('boundary polling cooldown preserves official-example success and resumes only the pending boundary check',async()=>{
 let posts=0;const first=bridge(url=>{
  if(url==='/graphql/')return ok({data:{userStatus:{isSignedIn:true,username:'Student'}}});
  if(url.includes('interpret_solution'))return ok({interpret_id:'run-'+(++posts)});
  return url.includes('/run-1/check/')?ok({state:'SUCCESS',run_success:true,correct_answer:true}):limited();
 });
 const question={...problem,additionalTestcases:[{input:'[1,2]\n3'}]},response=await first.send({problem:question});
 assert.equal(response.checkpoint.officialPassed,true);assert.equal(response.checkpoint.stage,'boundary');assert.equal(posts,2);
 const judgeRequests=first.requests.filter(r=>r.url!=='/graphql/');for(let i=1;i<judgeRequests.length;i++)assert.ok(judgeRequests[i].at-judgeRequests[i-1].at>=3000);
 const second=bridge(url=>url==='/graphql/'?ok({data:{userStatus:{isSignedIn:true,username:'Student'}}}):url.includes('/run-2/check/')?ok({state:'SUCCESS',run_success:true,correct_answer:true}):assert.fail('Passed examples or pending boundary request was reposted'),'Student',now+120000);
 const result=await second.send({problem:{...question,preflightCheckpoint:response.checkpoint}});assert.equal(result.value.ok,true);assert.equal(result.value.extraCases,1);
});
test('a checkpoint for changed code, examples or account is rejected and checks run afresh',async()=>{
 const first=bridge(url=>url==='/graphql/'?ok({data:{userStatus:{isSignedIn:true,username:'Student'}}}):url.includes('interpret_solution')?ok({interpret_id:'pending'}):limited());
 const response=await first.send();
 for(const changes of [{code:'different draft'},{problem:{...problem,exampleTestcases:'[1,2]\n3'}},{username:'Other'}]){
  let posts=0;const username=changes.username||'Student';
  const second=bridge(url=>url==='/graphql/'?ok({data:{userStatus:{isSignedIn:true,username}}}):url.includes('interpret_solution')?(posts++,ok({interpret_id:'fresh'})):ok({state:'SUCCESS',run_success:true,correct_answer:true}),username);
  const result=await second.send({...changes,problem:{...problem,...changes.problem,preflightCheckpoint:response.checkpoint}});assert.equal(result.value.ok,true);assert.equal(posts,1);
 }
});
test('a rejected submit HTTP 429 is marked definitely unsent, while no judged ID is fabricated',async()=>{
 const b=bridge(url=>url==='/graphql/'?ok({data:{userStatus:{isSignedIn:true,username:'Student'}}}):limited('45'));
 const response=await b.send({type:'leetcode-submit'});assert.equal(response.ok,false);assert.equal(response.submissionSent,false);assert.equal(response.retryAt,'2026-10-28T06:00:45.000Z');assert.equal(b.requests.length,2);
});
test('shared retry policy respects server deadlines and backs off unreported deadlines across repeated throttles',()=>{
 assert.equal(retryTime({retryAt:'2026-10-28T06:07:00Z'},now),'2026-10-28T06:07:00.000Z');
 assert.equal(retryTime({},now,0),'2026-10-28T06:01:00.000Z');assert.equal(retryTime({},now,1),'2026-10-28T06:02:00.000Z');assert.equal(retryTime({},now,9),'2026-10-28T06:15:00.000Z');
});
