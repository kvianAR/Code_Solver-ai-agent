import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/connection.js';

const {connect, serverUrl} = globalThis.agentConnection;
const state = {config: {}, jobs: [], notifications: []};
const answer = (status, value = state) => ({status, ok: status === 200, json: async () => value});

test('connection accepts server page links and rejects unsafe addresses', () => {
  assert.equal(serverUrl(' http://localhost:8790/health '), 'http://localhost:8790');
  assert.equal(serverUrl('https://agent.example/api/'), 'https://agent.example');
  for (const value of ['bad', 'ftp://localhost', 'http://agent.example', 'https://user:pass@agent.example', 'http://localhost:8790/?token=secret']) {
    assert.throws(() => serverUrl(value));
  }
});

test('connection finds this checkout when the old local server rejects its token', async () => {
  const calls = [];
  const result = await connect('http://localhost:8787', ' test-token ', async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'error');
    return answer(url === 'http://127.0.0.1:8790/api/state' ? 200 : 401);
  });
  assert.equal(result.connection.url, 'http://127.0.0.1:8790');
  assert.deepEqual(result.state, state);
  assert.equal(calls.length, 3);
});

test('connection recovers from localhost network failure through IPv4', async () => {
  const result = await connect('http://localhost:8790', 'token', async url => {
    if (url.includes('localhost')) throw TypeError('Failed to fetch');
    return answer(200);
  });
  assert.equal(result.connection.url, 'http://127.0.0.1:8790');
});

test('cloud connection never sends its token to fallback servers', async () => {
  const calls = [];
  await assert.rejects(connect('https://agent.example', 'token', async url => {
    calls.push(url); throw TypeError('Failed to fetch');
  }), /Cannot reach https:\/\/agent.example/);
  assert.deepEqual(calls, ['https://agent.example/api/state']);
});

test('connection distinguishes authentication and network failure', async () => {
  await assert.rejects(connect('http://localhost:8790', 'token', async () => answer(401)), /token did not match/);
  await assert.rejects(connect('http://localhost:8790', 'token', async () => { throw TypeError('Failed to fetch'); }), /Chrome allows this extension/);
});

test('connection does not accept an unrelated local service or an empty token', async () => {
  await assert.rejects(connect('http://localhost:8790', 'token', async () => answer(200, {ok: true})), /Cannot reach/);
  let requested = false;
  await assert.rejects(connect('http://localhost:8790', ' ', async () => { requested = true; }), /Enter the connection token/);
  assert.equal(requested, false);
});

test('first-install auto pairing saves the connection without a pasted token',async()=>{
  const saved={},secret='a'.repeat(64),token='b'.repeat(64),calls=[];
  const chromeApi={runtime:{getURL:name=>'chrome-extension://'+ 'a'.repeat(32)+'/'+name},storage:{local:{get:async()=>saved,set:async value=>Object.assign(saved,value)}}};
  const result=await globalThis.agentConnection.autoConnect(chromeApi,async(url,options)=>{
    calls.push(url);
    if(url.startsWith('chrome-extension:'))return answer(200,{url:'http://127.0.0.1:8790',pairingKey:secret});
    assert.equal(url,'http://127.0.0.1:8790/api/extension-pair');
    assert.equal(options.headers['X-Practice-Pairing'],secret);
    assert.equal(options.redirect,'error');return answer(200,{token});
  });
  assert.equal(result.token,token);assert.equal(saved.connection.url,'http://127.0.0.1:8790');assert.equal(calls.length,2);
});

test('auto pairing respects disconnect and never sends a pairing key to a remote host',async()=>{
  let requests=0;
  const chromeApi={runtime:{getURL:()=> 'local-file'},storage:{local:{get:async()=>({autoConnectDisabled:true}),set:async()=>{}}}};
  assert.equal(await globalThis.agentConnection.autoConnect(chromeApi,async()=>{requests++;}),null);
  assert.equal(requests,0);
  chromeApi.storage.local.get=async()=>({});
  await assert.rejects(globalThis.agentConnection.autoConnect(chromeApi,async()=>{
    requests++;return answer(200,{url:'https://example.invalid',pairingKey:'a'.repeat(64)});
  }),/Invalid local pairing/);
  assert.equal(requests,1);
});

test('explicit cloud connection is preserved during local auto pairing',async()=>{
  const connection={url:'https://agent.example',token:'existing'};
  const chromeApi={storage:{local:{get:async()=>({connection})}}};
  assert.deepEqual(await globalThis.agentConnection.autoConnect(chromeApi,async()=>{throw Error('must not replace cloud connection');}),connection);
});
