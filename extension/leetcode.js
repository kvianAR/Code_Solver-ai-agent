(() => {
  if (globalThis.__dailySolverLeetCodeBridge) return;
  globalThis.__dailySolverLeetCodeBridge = true;
  const ROADMAP = [
    'contains-duplicate','valid-anagram','valid-palindrome','best-time-to-buy-and-sell-stock','binary-search','valid-parentheses','merge-sorted-array','remove-duplicates-from-sorted-array','move-zeroes','majority-element','intersection-of-two-arrays','single-number','missing-number','reverse-string','first-unique-character-in-a-string','ransom-note','isomorphic-strings','word-pattern','linked-list-cycle','middle-of-the-linked-list','reverse-linked-list','merge-two-sorted-lists','maximum-depth-of-binary-tree','same-tree','invert-binary-tree','symmetric-tree','diameter-of-binary-tree','balanced-binary-tree','flood-fill','number-of-islands','climbing-stairs','min-cost-climbing-stairs','house-robber','maximum-subarray','product-of-array-except-self','top-k-frequent-elements','group-anagrams','longest-substring-without-repeating-characters','three-sum','container-with-most-water','search-in-rotated-sorted-array','find-minimum-in-rotated-sorted-array','combination-sum','permutations','subsets','word-search','validate-binary-search-tree','binary-tree-level-order-traversal','lowest-common-ancestor-of-a-binary-search-tree','kth-smallest-element-in-a-bst','course-schedule','clone-graph','rotting-oranges','coin-change','longest-increasing-subsequence','unique-paths','decode-ways','longest-common-subsequence','merge-intervals','insert-interval','trapping-rain-water','minimum-window-substring','median-of-two-sorted-arrays','serialize-and-deserialize-binary-tree','word-ladder'
  ];
  async function graphql(query, variables = {}) {
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response = await fetch('/graphql/', {method:'POST',credentials:'include',headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest'},body:JSON.stringify({query,variables})});
        if(!response.ok){
          if((response.status===429||response.status>=500)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));continue;}
          throw Error(`LeetCode connection failed (${response.status})`);
        }
        const value=await response.json();if(value.errors?.length)throw Error(value.errors[0].message||'LeetCode GraphQL error');return value.data;
      }catch(error){
        if(attempt===2||!/fetch|network|timed out/i.test(error.message))throw error;
        await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
      }
    }
  }
  const QUESTION_QUERY=`query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug content difficulty isPaidOnly status codeSnippets { lang langSlug code } topicTags { name slug } } }`;
  const DAILY_QUERY=`query questionOfToday { activeDailyCodingChallengeQuestion { date link question { title titleSlug difficulty isPaidOnly } } }`;
  const LIST_QUERY=`query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) { problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) { total: totalNum questions: data { titleSlug difficulty paidOnly: isPaidOnly status } } }`;
  const USER_QUERY=`query globalData { userStatus { isSignedIn username } }`;
  function plainText(html){const doc=new DOMParser().parseFromString(String(html||''),'text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());return(doc.body.textContent||'').replace(/\n\s*\n\s*\n+/g,'\n\n').trim();}
  async function question(slug,language){const q=(await graphql(QUESTION_QUERY,{titleSlug:slug})).question;if(!q)return null;const langSlug=language==='javascript'?'javascript':'python3',snippet=q.codeSnippets?.find(x=>x.langSlug===langSlug)||q.codeSnippets?.[0];return{id:q.questionId,frontendId:q.questionFrontendId,title:q.title,titleSlug:q.titleSlug,difficulty:q.difficulty,paidOnly:!!q.isPaidOnly,status:q.status||null,statement:plainText(q.content),starterCode:snippet?.code||'',langSlug:snippet?.langSlug||langSlug,topics:(q.topicTags||[]).map(x=>x.name)};}
  function shuffle(values){const result=[...values];for(let i=result.length-1;i>0;i--){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);const j=bytes[0]%(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
  async function problemsetSlugs(allowed,seen,wanted){
    const candidates=[];
    try{
      for(let skip=0;skip<1000&&candidates.length<wanted*3;skip+=100){
        const list=(await graphql(LIST_QUERY,{categorySlug:'',skip,limit:100,filters:{}})).problemsetQuestionList;
        for(const item of list?.questions||[])if(item?.titleSlug&&!seen.has(item.titleSlug)&&!item.paidOnly&&item.status==null&&allowed.has(item.difficulty))candidates.push(item.titleSlug);
        if(!list||skip+100>=list.total)break;
      }
    }catch(error){throw Error(`LeetCode question list unavailable: ${error.message}`);}
    return shuffle(candidates);
  }
  async function discover(options){
    const user=(await graphql(USER_QUERY)).userStatus;if(!user?.isSignedIn)throw Error('Brave me LeetCode login required');
    if(options.enforceUsername&&options.username&&user.username.toLowerCase()!==options.username.toLowerCase())throw Error(`Wrong LeetCode account: ${user.username}. Expected ${options.username}.`);
    if(options.requestedSlug){
      if(!/^[a-z0-9-]+$/.test(options.requestedSlug))throw Error('Invalid LeetCode question link');
      const selected=await question(options.requestedSlug,options.language);
      if(!selected)throw Error('This LeetCode question was not found');
      if(selected.paidOnly)throw Error('This question needs LeetCode Premium');
      selected.selection='CURRENT TAB';
      return{username:user.username,questions:[selected]};
    }
    const allowed=new Set(options.allowedDifficulties||['Easy','Medium','Hard']),chosen=[],seen=new Set(options.excludeSlugs||[]);
    let qotdNote='';
    if(options.requireQotd||options.preferQuestionOfTheDay){
      try{
        const daily=(await graphql(DAILY_QUERY)).activeDailyCodingChallengeQuestion?.question;
        if(!daily?.titleSlug){if(options.requireQotd)throw Error('LeetCode did not return today’s QOTD');qotdNote='LeetCode did not return a Question of the Day; using another question.';}
        else if(!options.requireQotd&&(options.acceptedTodaySlugs||[]).includes(daily.titleSlug))qotdNote=`QOTD ${daily.title} was already accepted today; using another question.`;
        else{
          const full=await question(daily.titleSlug,options.language);
          if(full&&!full.paidOnly){full.selection='QOTD';full.alreadyAcceptedToday=(options.acceptedTodaySlugs||[]).includes(full.titleSlug);chosen.push(full);seen.add(full.titleSlug);qotdNote=`QOTD selected: ${full.title}.`;}
          else {if(options.requireQotd)throw Error('Today’s QOTD is unavailable or Premium');qotdNote='QOTD is unavailable or Premium; using another question.';}
        }
      }catch(error){if(options.requireQotd)throw Error(`QOTD required: ${error.message}`);qotdNote='QOTD lookup failed; using another question.';}
    }
    const completed=Math.max(0,Number(options.completedCount)||0),start=Math.min(Math.floor(completed/10)*10,Math.max(0,ROADMAP.length-20));
    if(options.selectionMode!=='random'){
      const ordered=[...shuffle(ROADMAP.slice(start,start+20)),...shuffle(ROADMAP.slice(0,start)),...shuffle(ROADMAP.slice(start+20))];
      for(const slug of ordered){if(chosen.length>=options.count)break;if(seen.has(slug))continue;const q=await question(slug,options.language);if(q&&!q.paidOnly&&q.status==null&&allowed.has(q.difficulty)){q.selection='ROADMAP';chosen.push(q);seen.add(slug);}}
    }
    if(chosen.length<options.count){
      const slugs=await problemsetSlugs(allowed,seen,options.count-chosen.length);
      for(const slug of slugs){
        if(chosen.length>=options.count)break;
        const q=await question(slug,options.language);
        if(q&&!seen.has(q.titleSlug)&&!q.paidOnly&&q.status==null&&allowed.has(q.difficulty)){q.selection='RANDOM';chosen.push(q);seen.add(q.titleSlug);}
      }
    }
    if(!chosen.length)throw Error('No untouched eligible LeetCode question found');return{username:user.username,questions:chosen,qotdNote};
  }
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function submit(problem,code,expectedUsername){
    const user=(await graphql(USER_QUERY)).userStatus;
    if(!user?.isSignedIn)throw Error('Brave me LeetCode login required');
    if(expectedUsername&&user.username.toLowerCase()!==expectedUsername.toLowerCase())throw Error(`LeetCode account changed during submission: ${user.username}`);
    const csrf=document.cookie.split('; ').find(value=>value.startsWith('csrftoken='))?.split('=').slice(1).join('=');
    if(!csrf)throw Error('LeetCode session token unavailable. Reload the LeetCode tab and sign in again.');
    const response=await fetch(`/problems/${encodeURIComponent(problem.titleSlug)}/submit/`,{
      method:'POST',credentials:'include',headers:{'content-type':'application/json','x-csrftoken':decodeURIComponent(csrf),'x-requested-with':'XMLHttpRequest'},
      body:JSON.stringify({lang:problem.langSlug||'python3',question_id:String(problem.id),typed_code:code})
    });
    if(!response.ok)throw Error(`LeetCode submission failed (${response.status})`);
    const submitted=await response.json(),submissionId=submitted.submission_id||submitted.submissionId;
    if(!submissionId)throw Error('LeetCode did not return a submission id');
    for(let attempt=0;attempt<45;attempt++){
      await wait(1000);
      const check=await fetch(`/submissions/detail/${submissionId}/check/`,{credentials:'include',headers:{'x-requested-with':'XMLHttpRequest'}});
      if(!check.ok)throw Error(`LeetCode result check failed (${check.status})`);
      const result=await check.json();
      if(result.state!=='SUCCESS'&&!result.status_msg)continue;
      const accepted=result.status_msg==='Accepted'||result.status_code===10;
      const details=[result.status_msg,result.compile_error,result.runtime_error,result.last_testcase&&`Last testcase: ${result.last_testcase}`,result.expected_output&&`Expected: ${result.expected_output}`,result.code_output&&`Output: ${result.code_output}`].filter(Boolean).join(' ');
      return{accepted,submissionId:String(submissionId),feedback:details||'LeetCode judged the submission'};
    }
    throw Error('LeetCode result timed out');
  }
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{if(!['leetcode-discover','leetcode-session','leetcode-submit'].includes(message?.type))return;(async()=>{if(message.type==='leetcode-discover')return discover(message.options||{});if(message.type==='leetcode-submit')return submit(message.problem,message.code,message.username);const user=(await graphql(USER_QUERY)).userStatus;return{signedIn:!!user?.isSignedIn,username:user?.username||''};})().then(value=>sendResponse({ok:true,value})).catch(error=>sendResponse({ok:false,error:error.message}));return true;});
})();
