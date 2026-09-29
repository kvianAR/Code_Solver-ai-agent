import test from 'node:test';
import assert from 'node:assert/strict';
import {complete,requestJSON} from '../server/providers.mjs';
const config={maxOutputTokens:128,requestTimeoutSeconds:5};
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
