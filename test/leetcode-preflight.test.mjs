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
