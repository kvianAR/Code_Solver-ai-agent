(function(){
  const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const labels={pending:'Queued',queued:'Queued',discovering:'Selecting questions',drafting:'Writing solution',checking:'Checking syntax',testing:'Running tests',submitting:'Submitting to LeetCode',accepted:'Accepted',review:'Draft ready · awaiting submission',retrying:'Retry scheduled',waiting:'Retry scheduled',blocked:'Needs attention',failed:'Failed',stopped:'Stopped',interrupted:'Interrupted',skipped:'Historical skip'};
  function describe(run,launch){
    if(launch&&(!run||Date.parse(run.startedAt)<Date.parse(launch.startedAt))){
      return {target:launch.count,accepted:0,summary:`0/${launch.count} done`,step:launch.error||'Starting session · checking LeetCode login',tasks:[],error:!!launch.error};
    }
    if(!run)return null;
    const tasks=run.tasks||[],accepted=tasks.filter(task=>task.status==='accepted').length;
    const current=tasks.find(task=>task.problem?.titleSlug===run.currentQuestion)||tasks.find(task=>['drafting','checking','testing','submitting','blocked','failed','retrying'].includes(task.status));
    let step=labels[run.status]||run.status;
    if(run.status==='completed'&&accepted>=run.target)step='All requested questions accepted by LeetCode';
    else if(run.status==='review')step='Drafts prepared. Click Solve & submit to submit this batch.';
    else if(current)step=`${current.problem?.title||'Question'} · ${labels[current.status]||current.status}`;
    if(run.nextRetryAt&&['retrying','waiting'].includes(run.status))step+=` · ${new Date(run.nextRetryAt).toLocaleTimeString('en-IN',{timeZone:run.timezone||'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    if(!tasks.length)step=run.feedback||'Selecting untouched questions';
    return {target:run.target,accepted,summary:`${accepted}/${run.target} done`,step,tasks,error:['blocked','failed','interrupted'].includes(run.status),feedback:run.feedback||''};
  }
  function render(root,run,launch){
    const view=describe(run,launch);root.hidden=!view;if(!view)return;
    root.querySelector('#manual-status').textContent=view.summary;
    const progress=root.querySelector('#manual-progress');progress.max=view.target;progress.value=view.accepted;
    const step=root.querySelector('#manual-step');step.textContent=view.step;step.classList.toggle('error-text',view.error);
    root.querySelector('#manual-tasks').innerHTML=view.tasks.map((task,index)=>{
      const title=task.problem?.title||'Question '+(index+1),slug=task.problem?.titleSlug;
      const link=slug?`<a href="https://leetcode.com/problems/${encodeURIComponent(slug)}/" target="_blank" rel="noreferrer">${escape(title)}</a>`:escape(title);
      const failure=task.verification?.ok===false?'Syntax failed':task.preflight?.ok===false?'Tests failed':task.submissionHistory?.at(-1)?.status==='rejected'?'Judge rejected':'';
      const failed=!!failure;
      let status=labels[task.status]||task.status;
      if(failed&&task.status!=='accepted')status=['drafting','checking','testing','submitting'].includes(task.status)?`${status} · previous attempt failed`:failure+' · '+status;
      const tests=task.status==='accepted'?'Judge accepted':task.preflight?`Examples ${task.preflight.ok?'passed':'failed'}`:task.verification?`Syntax ${task.verification.ok?'passed':'failed'}`:'';
      const details=[tests,`${task.attempts||0} AI drafts`,`${task.submissionAttempts||0} judged submissions`,task.provider].filter(Boolean).join(' · ');
      const feedback=task.feedback&&task.status!=='accepted'?`<details ${['blocked','failed','retrying'].includes(task.status)?'open':''}><summary>Reason / feedback</summary><p>${escape(task.feedback)}</p></details>`:'';
      return `<li><div><span>${index+1}. </span>${link}<small>${escape(details)}</small>${feedback}</div><span class="manual-question-state ${(failed||['blocked','failed','interrupted'].includes(task.status))&&task.status!=='accepted'?'manual-question-error':''}">${escape(status)}</span></li>`;
    }).join('');
    if(view.feedback&&view.error&&!view.tasks.some(task=>task.feedback))root.querySelector('#manual-tasks').innerHTML+=`<li class="error-text">${escape(view.feedback)}</li>`;
  }
  globalThis.manualProgress={describe,render};
})();
