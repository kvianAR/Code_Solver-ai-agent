import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAssistance,recordAttempt,recordMistakes,studySummary,startInterview,reserveInterviewHint,releaseInterviewHint,finishInterview,saveInterviewDraft,parseInterviewFeedback,portableStudy} from '../server/study.mjs';
const problem={id:'1',title:'Two Sum',titleSlug:'two-sum',statement:'Find indices',starterCode:'class Solution: pass',topics:['Arrays']};
const date='2026-10-28',username='Student';
const fixture=()=>({state:{},save(){}});
test('AI-assisted practice cannot be recorded as independent, and no judge acceptance is created',()=>{
  const s=fixture();recordAssistance(s,date,username,problem,'hint');const attempt=recordAttempt(s,{username,titleSlug:'two-sum',title:'Two Sum',solved:true,withoutAI:true},date);
  assert.equal(attempt.source,'ai-assisted');assert.equal(attempt.hintsUsed,1);assert.equal(attempt.verification,'self-reported');assert.equal(s.state.leetcodeDailyCompletion,undefined);
});
test('independent self-reported attempts are separate, deduplicated and account specific',()=>{
  const s=fixture(),input={username,titleSlug:'two-sum',title:'Two Sum',solved:true,withoutAI:true};recordAttempt(s,input,date);recordAttempt(s,input,date);
  const report=studySummary(s,username);assert.equal(report.score.independentAttempts,1);assert.equal(report.score.independentSolved,1);assert.equal(studySummary(s,'Other').attempts.length,0);
});
test('mistake imports deduplicate archived copies and never create mistakes from clean acceptances',()=>{
  const s=fixture(),row={date,username,titleSlug:'two-sum',title:'Two Sum',feedback:'Wrong Answer: index boundary',hadFailure:true,accepted:false};
  recordMistakes(s,[row,row]);assert.equal(studySummary(s,username).entries.length,1);assert.equal(studySummary(s,username).entries[0].category,'boundary');
  recordMistakes(s,[{...row,feedback:'Accepted',accepted:true,hadFailure:false}]);assert.equal(studySummary(s,username).entries[0].resolved,true);
  recordMistakes(s,[{...row,titleSlug:'clean-question',feedback:'Accepted',accepted:true,hadFailure:false}]);assert.equal(studySummary(s,username).entries.length,1);
});
test('interview hint slots are atomic and failures refund only the failed request',()=>{
  const s=fixture(),row=startInterview(s,{username,problem,minutes:10,hintLimit:1},1000);
  const ticket=reserveInterviewHint(s,row.id,username,'hint',2000);assert.throws(()=>reserveInterviewHint(s,row.id,username,'hint',2000),/hint limit/);
  releaseInterviewHint(s,ticket);releaseInterviewHint(s,ticket);assert.equal(row.hintsUsed,0);
  reserveInterviewHint(s,row.id,username,'hint',2000).finished=true;assert.equal(row.hintsUsed,1);
});
test('interview deadlines survive reads and block late hints or draft changes',()=>{
  const s=fixture(),row=startInterview(s,{username,problem,minutes:10,hintLimit:2},1000);
  saveInterviewDraft(s,{id:row.id,username,code:'my draft'},2000);assert.equal(studySummary(s,username,3000).interviews[0].code,'my draft');
  assert.throws(()=>reserveInterviewHint(s,row.id,username,'hint',700000),/time is over/);assert.throws(()=>saveInterviewDraft(s,{id:row.id,username,code:'late'},700000),/time is over/);
  assert.equal(finishInterview(s,{id:row.id,username,code:'late submission'},700000).status,'expired');
});
test('full solutions and code review cannot bypass the interview hint limit',()=>{
  const s=fixture(),row=startInterview(s,{username,problem,minutes:10,hintLimit:2},1000);
  assert.throws(()=>reserveInterviewHint(s,row.id,username,'solution',2000),/Only limited hints/);assert.throws(()=>reserveInterviewHint(s,row.id,'Other','hint',2000),/not found/);
});
test('interview rubric is bounded and importing active interviews cancels the timer',()=>{
  assert.throws(()=>parseInterviewFeedback({rubric:{correctness:100,complexity:1,communication:1}}),/Invalid interview rubric/);
  const s=fixture();startInterview(s,{username,problem,minutes:10,hintLimit:1},1000);const restored=portableStudy(s.state.study);assert.equal(restored.interviews[0].status,'cancelled');
});
