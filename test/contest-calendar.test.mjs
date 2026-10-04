import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTEST_REFRESH_MS, contestRefreshDue, contestStatus, normalizeContestCalendar} from '../extension/contest-calendar.js';

test('calendar retains a recently ended weekly contest alongside upcoming events',()=>{
  const now=Date.parse('2026-10-04T19:25:00Z');
  const contests=normalizeContestCalendar([
    {title:'Weekly Contest 522',titleSlug:'weekly-contest-522',startTime:1791081000,duration:5400},
    {title:'Weekly Contest 523',titleSlug:'weekly-contest-523',startTime:1791685800,duration:5400},
    {title:'Weekly Contest 523',titleSlug:'weekly-contest-523',startTime:1791685800,duration:5400},
    {title:'Old contest',titleSlug:'weekly-contest-499',startTime:1700000000,duration:5400}
  ],now);
  assert.deepEqual(contests.map(c=>c.id),['weekly-contest-522','weekly-contest-523']);
  assert.equal(contestStatus(contests[0],now),'Ended');
  assert.equal(contestStatus(contests[1],now),'Upcoming');
  assert.equal(contests[0].startAt,'2026-10-04T02:30:00.000Z');
});

test('calendar refreshes roughly three times weekly',()=>{
  const now=Date.parse('2026-10-05T00:00:00Z');
  assert.equal(CONTEST_REFRESH_MS,56*3600000);
  assert.equal(contestRefreshDue(0,now),true);
  assert.equal(contestRefreshDue(now-CONTEST_REFRESH_MS+1,now),false);
  assert.equal(contestRefreshDue(now-CONTEST_REFRESH_MS,now),true);
});
