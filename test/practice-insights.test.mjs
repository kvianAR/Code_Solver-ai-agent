import test from 'node:test';
import assert from 'node:assert/strict';
import {recordMistakes,recordAttempt,portableStudy} from '../server/study.mjs';
import {revisionDeck,answerRevision,weeklyReport} from '../server/practice-insights.mjs';
const date='2026-10-28',username='Student';
function fixture(){const s={state:{config:{dailyQuestionCount:2},dailyProgress:{}},save(){}};recordMistakes(s,[{date,username,titleSlug:'two-sum',title:'Two Sum',feedback:'Wrong answer on empty boundary',hadFailure:true}]);return s;}
test('revision quizzes use personal notebook, hide answers, schedule recall and keep the first daily score',()=>{
  const s=fixture(),deck=revisionDeck(s,username,date);assert.equal(deck.length,1);assert.equal(deck[0].category,undefined);assert.equal(revisionDeck(s,'Other',date).length,0);
  const input={username,id:deck[0].id,answer:'language'},first=answerRevision(s,input,date);assert.equal(first.correct,false);assert.equal(first.nextReview,'2026-10-29');
  const second=answerRevision(s,{...input,answer:'boundary'},date);assert.equal(second.correct,true);assert.equal(second.recordedCorrect,false);assert.equal(s.state.study.revisions.length,1);
  assert.equal(revisionDeck(s,username,date).length,0);assert.equal(revisionDeck(s,username,'2026-10-29').length,1);assert.equal(s.state.leetcodeDailyCompletion,undefined);
  assert.throws(()=>answerRevision(s,{...input,username:'Other'},date),/valid notebook/);
  const restored=portableStudy(s.state.study);assert.equal(restored.revisions[0].correct,false);restored.revisions[0].correct='yes';assert.throws(()=>portableStudy(restored),/Invalid revision/);
});
test('weekly report keeps unknown days, actual judge progress, independent scores and quiz scores separate',()=>{
  const s=fixture();s.state.dailyProgress[date]={'account:student':{accepted:2,target:2,qotdAccepted:true},'account:other':{accepted:9,target:9,qotdAccepted:true}};
  recordAttempt(s,{username,titleSlug:'own',solved:true,withoutAI:true},date);recordAttempt(s,{username,titleSlug:'helped',solved:true,withoutAI:false},date);
  const report=weeklyReport(s,'student',date);assert.equal(report.days.length,7);assert.equal(report.recordedDays,1);assert.equal(report.completedDays,1);
  assert.equal(report.days[0].accepted,null);assert.equal(report.days.at(-1).independentSolved,1);assert.equal(report.days.at(-1).assistedAttempts,1);assert.equal(report.repeatedMistakes[0].category,'boundary');
  assert.equal(weeklyReport(s,'Other',date).days.at(-1).independentAttempts,0);
  s.state.dailyProgress[date]['account:student'].qotdAccepted=false;assert.equal(weeklyReport(s,username,date).completedDays,0);
});
