import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../extension/leetcode.js',import.meta.url),'utf8');
async function runCode(result){
  let listener,submitted=false;
  const context=vm.createContext({
    globalThis:null,
    chrome:{runtime:{onMessage:{addListener(callback){listener=callback;}}}},
    document:{cookie:'csrftoken=sample'},
    setTimeout(callback){callback();},
    fetch:async(url)=>{
      if(url==='/graphql/')return{ok:true,json:async()=>({data:{userStatus:{isSignedIn:true,username:'Tester'}}})};
      if(url.includes('/interpret_solution/'))return{ok:true,json:async()=>({interpret_id:'run-1'})};
      if(url.includes('/check/'))return{ok:true,json:async()=>({state:'SUCCESS',run_success:true,...result})};
      if(url.includes('/submit/'))submitted=true;
      throw Error(`Unexpected request: ${url}`);
    }
  });
  context.globalThis=context;
  vm.runInContext(source,context);
  const answer=await new Promise(resolve=>listener({type:'leetcode-preflight',problem:{titleSlug:'two-sum',id:'1',langSlug:'python3',exampleTestcases:'[2,7]\n9'},code:'class Solution: pass',username:'Tester'},null,resolve));
  return{answer,submitted};
}
test('Run Code pass allows the later runner gate without submitting in the bridge',async()=>{
  const {answer,submitted}=await runCode({correct_answer:true});
  assert.equal(answer.value.ok,true);assert.equal(submitted,false);
});
test('Run Code mismatch rejects before judged submission',async()=>{
  const {answer,submitted}=await runCode({correct_answer:false,status_msg:'Wrong Answer',expected_code_answer:['[0,1]'],code_answer:['[1,0]']});
  assert.equal(answer.value.ok,false);assert.match(answer.value.feedback,/Wrong Answer/);assert.equal(submitted,false);
});

async function extraCaseScenario(boundary){
  let listener,runs=0,submitted=false;
  const sandbox={chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},document:{cookie:'csrftoken=test'},setTimeout:fn=>fn(),
    fetch:async(url,request)=>{
      if(url==='/graphql/')return {ok:true,json:async()=>({data:{userStatus:{isSignedIn:true,username:'Tester'}}})};
      if(url.includes('/interpret_solution/')){runs++;const input=JSON.parse(request.body).data_input;assert.equal(input,runs===1?'[2,7]\n9':'[]\n0');return {ok:true,json:async()=>({interpret_id:String(runs)})};}
      if(url.includes('/check/'))return {ok:true,json:async()=>runs===1?{state:'SUCCESS',run_success:true,correct_answer:true}:{state:'SUCCESS',...boundary}};
      if(url.includes('/submit/'))submitted=true;throw Error('Unexpected request');
    }};
  vm.runInNewContext(source,sandbox);
  const response=await new Promise(resolve=>listener({type:'leetcode-preflight',problem:{titleSlug:'two-sum',id:'1',exampleTestcases:'[2,7]\n9',additionalTestcases:[{input:'[]\n0'}]},code:'pass',username:'Tester'},null,resolve));
  return {response,runs,submitted};
}
test('invalid generated inputs do not masquerade as an algorithm failure',async()=>{
  const {response,runs,submitted}=await extraCaseScenario({status_msg:'Invalid Testcase'});
  assert.equal(runs,2);assert.equal(response.value.ok,true);assert.equal(response.value.extraStatus,'invalid-input');assert.equal(response.value.extraCases,0);assert.equal(submitted,false);
});
test('a real runtime error in a valid boundary case still blocks judged submission',async()=>{
  const {response}=await extraCaseScenario({run_success:false,status_msg:'Runtime Error',runtime_error:'ValueError: invalid input'});
  assert.equal(response.value.ok,false);assert.equal(response.value.extraStatus,'solution-failed');
});
