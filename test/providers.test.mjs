import test from 'node:test';
import assert from 'node:assert/strict';
import {complete,requestJSON,solutionPrompt} from '../server/providers.mjs';
const config={maxOutputTokens:128,requestTimeoutSeconds:5};
test('owned-test style changes presentation without changing the problem contract',()=>{
  const problem={title:'Example',statement:'Find the answer',examples:[]};
  const natural=solutionPrompt(problem,'python','','natural');
  const direct=solutionPrompt(problem,'python','','direct');
  assert.match(natural,/descriptive names/);
  assert.match(natural,/Do not invent a personal story/);
  assert.match(direct,/concise code/i);
  assert.match(natural,/Define def solve\(data\)/);
  assert.match(direct,/Define def solve\(data\)/);
});
test('Groq and Gemini use correct headers and parse usage',async()=>{
  const original=globalThis.fetch;
  try {
    for(const provider of ['groq','gemini']){
      globalThis.fetch=async(url,options)=>{
        const body=JSON.parse(options.body);
        if(provider==='gemini'){assert.match(url,/generateContent$/);assert.equal(options.headers['x-goog-api-key'],'test');assert.ok(body.contents);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"code":"hello"}'}]}}],usageMetadata:{totalTokenCount:21}}));}
        assert.equal(options.headers.Authorization,'Bearer test');assert.match(url,/chat\/completions$/);assert.ok(body.messages);return new Response(JSON.stringify({choices:[{message:{content:'{"code":"hello"}'}}],usage:{total_tokens:21}}));
      };
      const r=await complete(provider,'test','example-model','prompt',config);assert.equal(r.tokens,21);assert.equal(r.text,'{"code":"hello"}');
    }
  }finally{globalThis.fetch=original;}
});
test('HTTP error classification hides sensitive response text',async()=>{
  const original=globalThis.fetch;
  try {
    for(const [status,body,kind] of [[401,'secret-key-123','key'],[429,'insufficient_quota secret-key-123','quota'],[429,'RESOURCE_EXHAUSTED rate quota requests per minute','rate'],[429,'too many requests','rate'],[503,'unavailable','temporary'],[400,'unknown model','request']]){
      globalThis.fetch=async()=>new Response(body,{status});
      await assert.rejects(requestJSON('https://example.invalid'),e=>e.kind===kind&&!e.message.includes('secret-key'));
    }
  }finally{globalThis.fetch=original;}
});

test('Groq defaults to its official endpoint and supports an explicit local proxy',async()=>{
  const original=globalThis.fetch,urls=[];
  try{
    globalThis.fetch=async url=>{urls.push(url);return new Response(JSON.stringify({choices:[{message:{content:'{"code":"pass"}'}}]}));};
    await complete('groq','test','model','prompt',config);
    await complete('groq','test','model','prompt',{...config,groqBaseUrl:'http://127.0.0.1:3011/v1'});
    assert.deepEqual(urls,['https://api.groq.com/openai/v1/chat/completions','http://127.0.0.1:3011/v1/chat/completions']);
  }finally{globalThis.fetch=original;}
});

test('available models use provider authentication and filter Gemini generation models',async()=>{
  const {listModels}=await import('../server/providers.mjs');const original=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{
      if(url.includes('groq.com')){assert.equal(options.headers.Authorization,'Bearer private-key');return new Response(JSON.stringify({data:[{id:'model-b'},{id:'model-a'}]}));}
      assert.equal(options.headers['x-goog-api-key'],'private-key');
      return new Response(JSON.stringify({models:[{name:'models/generate-model',supportedGenerationMethods:['generateContent']},{name:'models/embedding-only',supportedGenerationMethods:['embedContent']}]}));
    };
    assert.deepEqual(await listModels('groq','private-key',config),['model-a','model-b']);
    assert.deepEqual(await listModels('gemini','private-key',config),['generate-model']);
  }finally{globalThis.fetch=original;}
});

test('generated boundary inputs are bounded and never treated as expected answers',async()=>{
  const {decodeSolution}=await import('../server/providers.mjs');
  const result=decodeSolution(JSON.stringify({code:'pass',testCases:[{input:'[1]\n0',expected:'untrusted',reason:'small'},...Array.from({length:8},()=>({input:'x'.repeat(5000)}))]}));
  assert.equal(result.testCases.length,1);assert.equal(result.testCases[0].expected,undefined);
});

test('solution decoding accepts a bounded solution wrapper and code fences but rejects malformed shapes as output failures',async()=>{
 const {decodeSolution}=await import('../server/providers.mjs');
 assert.equal(decodeSolution(JSON.stringify({solution:{code:'```python\nclass Solution: pass\n```',approach:'hash-map'}})).code,'class Solution: pass');
 for(const text of ['null','[]','{"code":42}','{"explanation":"missing code"}','not json'])assert.throws(()=>decodeSolution(text),e=>e.kind==='output');
});
test('direct Groq requests demand JSON and a token-truncated response cannot become a solution',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async(_url,request)=>{assert.equal(JSON.parse(request.body).response_format.type,'json_object');return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"code":"unfinished'}}]}));};
 await assert.rejects(complete('groq','test','example-model','Return JSON',config),error=>error.kind==='output'&&/truncated/.test(error.message));
 }finally{globalThis.fetch=original;}
});
test('provider retry deadlines accept HTTP dates and are not shortened to five minutes',async()=>{
 const original=globalThis.fetch,deadline=new Date(Date.now()+10*60000).toUTCString();
 try{globalThis.fetch=async()=>new Response('temporarily unavailable',{status:503,headers:{'retry-after':deadline}});await assert.rejects(requestJSON('https://provider.example'),error=>error.kind==='temporary'&&error.retryAfter>=598);
 }finally{globalThis.fetch=original;}
});
