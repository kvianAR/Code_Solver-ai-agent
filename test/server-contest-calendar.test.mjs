import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshOfficialContests} from '../server/contest-calendar.mjs';

test('official calendar caches recent and upcoming contests for 56 hours',async()=>{
  const store={state:{},saves:0,save(){this.saves++}};
  const now=Date.parse('2026-10-04T19:25:00Z');
  let calls=0;
  const fetcher=async(_url,options)=>{
    calls++;
    assert.match(JSON.parse(options.body).query,/allContests/);
    return {ok:true,json:async()=>({data:{allContests:[
      {title:'Weekly Contest 522',titleSlug:'weekly-contest-522',startTime:1791081000,duration:5400},
      {title:'Weekly Contest 523',titleSlug:'weekly-contest-523',startTime:1791685800,duration:5400}
    ]}})};
  };
  const first=await refreshOfficialContests(store,{now,fetcher});
  assert.deepEqual(first.events.map(c=>c.title),['Weekly Contest 522','Weekly Contest 523']);
  await refreshOfficialContests(store,{now:now+3600000,fetcher});
  assert.equal(calls,1);
  assert.equal(store.saves,1);
});

test('calendar fetch failure retains saved events and backs off',async()=>{
  const now=Date.parse('2026-10-05T00:00:00Z');
  const event={id:'weekly-contest-523',title:'Weekly Contest 523',startAt:'2026-10-11T02:30:00.000Z'};
  const store={state:{contestCalendar:{events:[event],updatedAt:now-57*3600000,failedAt:0,error:''}},save(){}};
  let calls=0;
  const fetcher=async()=>{calls++;throw Error('offline')};
  const result=await refreshOfficialContests(store,{now,fetcher});
  assert.deepEqual(result.events,[event]);
  assert.equal(result.error,'offline');
  await refreshOfficialContests(store,{now:now+1000,fetcher});
  assert.equal(calls,1);
});
