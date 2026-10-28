import {studySummary} from './study.mjs';
const categories=['approach','boundary','complexity','language','other'];
const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase();
const dayBefore=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')-days*86400000).toISOString().slice(0,10);
export function revisionDeck(store,username,date){
  const summary=studySummary(store,username),history=(store.state.study.revisions||[]).filter(row=>same(row.username,username));
  return summary.entries.filter(entry=>{
    const last=history.filter(row=>row.entryId===entry.id).sort((a,b)=>b.date.localeCompare(a.date))[0];
    return !last||date>=dayBefore(last.date,-(last.correct?3:1));
  }).sort((a,b)=>Number(a.resolved)-Number(b.resolved)||b.date.localeCompare(a.date)).slice(0,20).map(entry=>{
    const offset=[...entry.id].reduce((n,c)=>n+c.charCodeAt(0),0)%categories.length;
    return {id:entry.id,title:entry.title,titleSlug:entry.titleSlug,date:entry.date,
      question:'Which mistake type best describes this recorded failure?',context:entry.feedback||'Recall what went wrong in this attempt.',
      options:[...categories.slice(offset),...categories.slice(0,offset)]};
  });
}
export function answerRevision(store,input,date){
  const summary=studySummary(store,input.username),entry=summary.entries.find(row=>row.id===input.id);
  if(!entry||!categories.includes(input.answer))throw Error('Choose a valid notebook quiz and answer');
  const correct=input.answer===entry.category;
  const row={id:`revision:${date}:${input.username.toLowerCase()}:${entry.titleSlug}`,entryId:entry.id,username:input.username,date,answer:input.answer,correct};
  const rows=store.state.study.revisions||=[];
  const old=rows.find(r=>r.id===row.id);
  // Keep the first answer for a day so repeated reveals cannot inflate the score.
  if(!old){if(rows.length>=10000)throw Error('Revision history is full; export a backup before continuing');rows.push(row);store.save();}
  return {correct,recordedCorrect:old?.correct??correct,category:entry.category,feedback:entry.feedback,note:entry.note||'',codeSnippet:entry.codeSnippet||'',nextReview:dayBefore(date,-((old?.correct??correct)?3:1)),verification:'Notebook recall only; not a judge result'};
}
export function weeklyReport(store,username,date){
  const summary=studySummary(store,username),revisions=(store.state.study.revisions||[]).filter(row=>same(row.username,username));
  const days=[];
  for(let i=6;i>=0;i--){
    const key=dayBefore(date,i),progress=store.state.dailyProgress?.[key]?.['account:'+username.toLowerCase()];
    const attempts=summary.attempts.filter(r=>r.date===key),reviews=revisions.filter(r=>r.date===key),target=progress?.target||store.state.config.dailyQuestionCount;
    days.push({date:key,accepted:progress?.accepted??null,target,targetEstimated:!progress?.target,qotdAccepted:progress?.qotdAccepted??false,qotdExempt:progress?.qotdExempt||'',
      completed:!!progress&&progress.accepted>=target&&!!(progress.qotdAccepted||progress.qotdExempt),
      independentSolved:attempts.filter(r=>r.source==='independent'&&r.solved).length,independentAttempts:attempts.filter(r=>r.source==='independent').length,
      assistedAttempts:attempts.filter(r=>r.source!=='independent').length,quizCorrect:reviews.filter(r=>r.correct).length,quizAttempts:reviews.length});
  }
  const mistakes=summary.entries.filter(r=>r.date>=days[0].date&&r.date<=date),counts={};
  for(const entry of mistakes)counts[entry.category]=(counts[entry.category]||0)+1;
  return {username,from:days[0].date,to:date,days,completedDays:days.filter(d=>d.completed).length,recordedDays:days.filter(d=>d.accepted!==null).length,
    repeatedMistakes:Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([category,count])=>({category,count})),
    notes:['Unknown daily results are not counted as zero or completed.','Older daily targets use the current allotment when no historical target was recorded.','Independent practice is self-reported. Notebook quizzes do not create accepted judge results.']};
}
