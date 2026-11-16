import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const context={};runInNewContext(readFileSync(new URL('../extension/manual-progress.js',import.meta.url),'utf8'),context);
const {describe,render}=context.manualProgress;
const task=(title,status)=>({problem:{title,titleSlug:title},status});
test('manual counter records only accepted judge results and displays every queued question',()=>{
 const run={target:2,status:'running',currentQuestion:'second',tasks:[task('first','accepted'),task('second','testing')]};
 const view=describe(run);assert.equal(view.summary,'1/2 done');assert.equal(view.tasks.length,2);assert.match(view.step,/second.*Running tests/);
 run.tasks[1].status='accepted';run.status='completed';assert.equal(describe(run).summary,'2/2 done');assert.match(describe(run).step,/All requested questions accepted/);
 run.tasks[1].status='review';run.status='review';assert.equal(describe(run).summary,'1/2 done');assert.match(describe(run).step,/Click Solve & submit/);
});
test('manual launch immediately shows selected count and retains launch errors instead of an old run',()=>{
 const launch={count:5,startedAt:'2026-11-16T17:00:00Z'};
 const old={target:2,startedAt:'2026-11-16T16:00:00Z',tasks:[task('old','accepted')]};
 assert.equal(describe(old,launch).summary,'0/5 done');assert.match(describe(old,launch).step,/Starting session/);
 launch.error='Sign in to LeetCode';assert.equal(describe(old,launch).step,launch.error);assert.equal(describe(old,launch).error,true);
});
test('manual rows expose failed tests, accepted results, names and escaped feedback',()=>{
 const elements=Object.fromEntries(['manual-status','manual-progress','manual-step','manual-tasks'].map(id=>[id,{classList:{toggle(){}}}]));
 const root={querySelector:selector=>elements[selector.slice(1)]};
 render(root,{target:2,status:'blocked',currentQuestion:'second',tasks:[task('first','accepted'),{...task('second','blocked'),preflight:{ok:false},feedback:'Wrong Answer <script>alert(1)</script>',attempts:3}]});
 assert.equal(elements['manual-status'].textContent,'1/2 done');assert.equal(elements['manual-progress'].value,1);
 const html=elements['manual-tasks'].innerHTML;assert.match(html,/Accepted/);assert.match(html,/Tests failed/);assert.match(html,/Examples failed/);assert.match(html,/Wrong Answer &lt;script&gt;/);assert.ok(!html.includes('<script>'));assert.match(html,/details open/);
});
test('manual progress markup is next to the controls with one instance of every id',()=>{
 const html=readFileSync(new URL('../extension/dashboard.html',import.meta.url),'utf8');
 for(const id of ['manual-section','manual-status','manual-progress','manual-step','manual-tasks'])assert.equal(html.split(`id="${id}"`).length-1,1,id);
 assert.ok(html.indexOf('id="manual-section"')>html.indexOf('id="run-now"'));assert.ok(html.indexOf('id="manual-section"')<html.indexOf('class="stats"'));
 assert.ok(html.indexOf('src="manual-progress.js"')<html.indexOf('src="app.js"'));
});
