import test from 'node:test';
import assert from 'node:assert/strict';
import {testStrategy} from '../server/test-strategy.mjs';
test('boundary plans distinguish arrays, graphs, dynamic programming and linked lists',()=>{
  for(const [topic,family] of [['Array','array'],['Graph Theory','graph'],['Dynamic Programming','dynamic-programming'],['Linked List','linked-list']])assert.equal(testStrategy({topics:[topic]}).family,family);
  assert.match(testStrategy({topics:['Graph']}).checks.join(' '),/only when/);
});
