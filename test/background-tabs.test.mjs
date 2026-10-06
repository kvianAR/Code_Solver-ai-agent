import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8')
  .replace(/^import .*?;\n/gm,'');

async function runPoll(due){
  const tabs=[],created=[],removed=[],saved={connection:{url:'http://127.0.0.1:8787',token:'test'},
    leetcodeRuns:{},leetcodeAccount:'TestUser',contestCalendarVersion:2,
    contestCalendarUpdatedAt:Date.now(),leetcodeContests:[]};
  const config={autoMode:true,dailyStartTime:due?'00:00':'23:59',timezone:'Asia/Kolkata',
    dailyQuestionCount:2,leetcode:{enabled:true}};
  const state={config,notifications:[],jobs:[],today:'2026-10-06'};
  const chrome={
    storage:{local:{
      async get(keys){if(typeof keys==='string')return {[keys]:saved[keys]};
        if(Array.isArray(keys))return Object.fromEntries(keys.map(key=>[key,saved[key]]));
        return Object.fromEntries(Object.entries(keys).map(([key,value])=>[key,saved[key]??value]));},
      async set(value){Object.assign(saved,value);},async remove(key){delete saved[key];},
      async setAccessLevel(){} }},
    alarms:{async create(){},onAlarm:{addListener(){}}},
    notifications:{async create(){},onClicked:{addListener(){}}},
    runtime:{id:'test-extension',onInstalled:{addListener(){}},onStartup:{addListener(){}},
      onMessage:{addListener(){}},getURL:path=>`chrome-extension://test/${path}`},
    tabs:{async query(){return [...tabs];},async create(options){const tab={id:7,url:options.url,status:'complete'};
      tabs.push(tab);created.push(tab);return tab;},async get(id){const tab=tabs.find(tab=>tab.id===id);
      if(!tab)throw Error('Tab gone');return tab;},async remove(id){removed.push(id);tabs.splice(tabs.findIndex(tab=>tab.id===id),1);},
      onUpdated:{addListener(){},removeListener(){}},async sendMessage(){return {ok:true,value:{signedIn:true,username:'TestUser'}};}},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},
    scripting:{async executeScript(){}}
  };
  class Runner{
    constructor(){this.active=null;}
    async recover(){}
    start(){this.done=Promise.resolve();return {started:true,id:'automatic:2026-10-06:testuser'};}
  }
  runInNewContext(source,{chrome,LeetCodeRunner:Runner,activeContest:()=>null,contestRefreshDue:()=>false,
    localClock:()=>({date:'2026-10-06',time:'12:00'}),dailyRunForAccount:()=>null,
    latestArchivedAutomaticRun:()=>null,automaticRetryDecision:()=>({due}),
    archiveRetryableAutomaticRun:()=>false,shouldRetryForLaterSchedule:()=>false,
    fetch:async()=>({ok:true,json:async()=>state}),Date,crypto:{randomUUID:()=>''},
    setInterval(){},setTimeout,clearTimeout,AbortSignal,URL});
  for(let i=0;i<20&&!saved.lastPollAt;i++)await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(saved.lastPollAt,'background poll finished');
  return {created,removed,tabs,saved};
}

test('idle scheduler does not open LeetCode; a due run closes its temporary tab',async()=>{
  const idle=await runPoll(false);
  assert.equal(idle.created.length,0);
  const due=await runPoll(true);
  assert.equal(due.created.length,1);
  assert.deepEqual(due.removed,[7]);
  assert.equal(due.tabs.length,0);
});
