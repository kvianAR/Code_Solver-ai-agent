import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8')
  .replace(/^import .*?;\n/gm,'')
  .replace('init().catch(()=>{});','')+'\nglobalThis.handleContests=handleContests;';

async function contestOpener(existingTab=false){
  const now=Date.now(),url='https://leetcode.com/contest/weekly-contest-524/';
  const saved={contestCalendarVersion:2,contestCalendarUpdatedAt:now,
    leetcodeContests:[{id:'weekly-contest-524',title:'Weekly Contest 524',url,
      startAt:new Date(now-60000).toISOString(),endAt:new Date(now+60000).toISOString(),
      openedAt:'',reminders:{}}]};
  const tabs=existingTab?[{id:1,url}]:[],created=[],notifications=[];
  const chrome={
    storage:{local:{async get(keys){return Object.fromEntries(keys.map(key=>[key,saved[key]]));},
      async set(value){Object.assign(saved,value);}}},
    tabs:{async query(){return tabs;},async create(options){created.push(options);tabs.push({id:2,url:options.url});}},
    notifications:{async create(id,options){notifications.push({id,...options});},onClicked:{addListener(){}}},
    runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(){}}},
    alarms:{onAlarm:{addListener(){}}},action:{},
  };
  class Runner{async recover(){}}
  const context={chrome,LeetCodeRunner:Runner,contestRefreshDue:()=>false,
    Date,URL,setInterval(){}};
  runInNewContext(source,context);
  await context.handleContests();
  await context.handleContests();
  return {saved,created,notifications};
}

test('opens an official live contest once and records it after opening',async()=>{
  const {saved,created,notifications}=await contestOpener();
  assert.equal(created.length,1);
  assert.equal(created[0].active,true);
  assert.equal(created[0].url,'https://leetcode.com/contest/weekly-contest-524/');
  assert.ok(saved.leetcodeContests[0].openedAt);
  assert.equal(notifications.length,1);
});

test('reuses an existing contest tab without opening a duplicate',async()=>{
  const {saved,created,notifications}=await contestOpener(true);
  assert.equal(created.length,0);
  assert.ok(saved.leetcodeContests[0].openedAt);
  assert.equal(notifications.length,1);
});
