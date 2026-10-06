import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('daily discovery retries a temporary fetch failure and selects QOTD plus an untouched question', async () => {
  let listener, calls=0, listCalls=0;
  const fetch=async (_url,request) => {
    calls++;
    if(calls===1)throw new TypeError('Failed to fetch');
    const {query,variables}=JSON.parse(request.body);
    let data;
    if(query.includes('userStatus'))data={userStatus:{isSignedIn:true,username:'Leetcoder071'}};
    else if(query.includes('activeDailyCodingChallengeQuestion'))data={activeDailyCodingChallengeQuestion:{question:{titleSlug:'minimum-add-to-make-parentheses-valid'}}};
    else if(query.includes('questionList(')){
      listCalls++;
      assert.match(query,/total:\s*totalNum/);
      assert.match(query,/questions:\s*data/);
      data={problemsetQuestionList:{total:2,questions:[{titleSlug:'two-sum',difficulty:'Easy',paidOnly:false,status:'ac'},
        {titleSlug:'valid-anagram',difficulty:'Easy',paidOnly:false,status:null}]}};
    }else if(query.includes('question(titleSlug:')){
      data={question:{questionId:variables.titleSlug==='valid-anagram'?'242':'921',questionFrontendId:'1',title:variables.titleSlug,
        titleSlug:variables.titleSlug,content:'<p>Solve it</p>',difficulty:'Easy',isPaidOnly:false,status:null,
        codeSnippets:[{langSlug:'python3',code:'class Solution: pass'}],topicTags:[]}};
    }else throw Error('Unexpected GraphQL query');
    return {ok:true,json:async()=>({data})};
  };
  const sandbox={fetch,chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},
    DOMParser:class{parseFromString(html){return {querySelectorAll(){return [];},body:{textContent:html.replace(/<[^>]+>/g,'')}};}},
    crypto:{getRandomValues(bytes){bytes[0]=0;return bytes;}},setTimeout:(fn)=>{fn();return 0;}};
  runInNewContext(readFileSync(new URL('../extension/leetcode.js',import.meta.url),'utf8'),sandbox);
  const result=await new Promise(resolve=>listener({type:'leetcode-discover',options:{username:'Leetcoder071',count:2,
    enforceUsername:true,language:'python',allowedDifficulties:['Easy'],requireQotd:true,selectionMode:'random',
    excludeSlugs:[],acceptedTodaySlugs:[]}}, {}, resolve));
  assert.equal(result.ok,true,result.error);
  assert.equal(result.value.questions.length,2);
  assert.deepEqual(Array.from(result.value.questions,q=>q.selection),['QOTD','RANDOM']);
  assert.equal(result.value.questions[1].titleSlug,'valid-anagram');
  assert.equal(listCalls,1);
  assert.ok(calls>=5);
});
