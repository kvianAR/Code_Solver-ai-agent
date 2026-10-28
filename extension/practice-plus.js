(() => {
  let notebookLimit=50;let summary=null,loadedUser='',lastLoad=0,loading=false,currentInterview=null,draftTimer,working=false;
  const context=()=>advancedFeatures.context();
  const account=()=>$('#study-account').value.trim()||context().username||leetcodeAccount;
  const error=exception=>toast(exception.message);
  function paint(){
    if(!summary)return;
    const score=summary.score;
    $('#independent-score').textContent=`Self-reported independent practice: ${score.independentSolved}/${score.independentAttempts} solved. Assisted/not declared independent: ${score.assistedAttempts}.`;
    const accepted=new Set();
    for(const run of Object.values(leetcodeRuns))if(run.username?.toLowerCase()===loadedUser.toLowerCase())for(const task of run.tasks||[])if(task.status==='accepted')accepted.add(run.date+':'+task.problem?.titleSlug);
    $('#assisted-score').textContent=`AI-assisted accepted questions in this extension's history: ${accepted.size}. Independent results are self-reported, not judge acceptances.`;
    $('#practice-records').innerHTML=[...summary.attempts].reverse().slice(0,20).map(row=>`<article class="card"><strong>${esc(row.title)}</strong><p>${esc(row.date)} · ${esc(row.source)} · ${row.solved?'Self-reported solved':'Still practising'} · ${row.hintsUsed} recorded hints</p></article>`).join('')||'<p class="muted">Save your own attempts here; automatic daily results stay separate.</p>';
    if(!$('#mistake-records').contains(document.activeElement))$('#mistake-records').innerHTML=[...summary.entries].reverse().slice(0,notebookLimit).map(row=>`<form class="card" data-mistake-id="${esc(row.id)}"><h2>${esc(row.title)}</h2><p>${esc(row.date)} · ${esc(row.source)} · ${row.resolved?'Resolved':'Needs revision'}</p><p>${esc(row.feedback)}</p><div class="form-grid"><label>Mistake type<select name="category">${['approach','boundary','complexity','language','other'].map(kind=>`<option value="${kind}" ${kind===row.category?'selected':''}>${kind}</option>`).join('')}</select></label><label><input name="resolved" type="checkbox" ${row.resolved?'checked':''}> Resolved</label></div><label>What I learned<textarea name="note" rows="3" maxlength="4000">${esc(row.note||'')}</textarea></label>${row.codeSnippet?`<details><summary>Saved code snippet</summary><pre>${esc(row.codeSnippet)}</pre></details>`:''}<button>Save note</button></form>`).join('')||'<p class="muted">No recorded algorithm mistakes for this account. Import past extension history or save an unsuccessful practice attempt.</p>';
    $('#notebook-more').hidden=summary.entries.length<=notebookLimit;
    const latest=summary.interviews.find(row=>row.id===currentInterview?.id)||[...summary.interviews].reverse().find(row=>row.status==='active')||summary.interviews.at(-1);
    if(latest){const changed=currentInterview?.id!==latest.id;currentInterview=latest;$('#interview-workspace').hidden=false;$('#interview-title').textContent=latest.problem.title;if(changed||!$('#interview-code').value)$('#interview-code').value=latest.code||'';showFeedback(latest.feedback);tick();}
    else{$('#interview-workspace').hidden=true;currentInterview=null;}
  }
  async function load(force=false){
    const username=account();if(!username||loading||!force&&username===loadedUser&&Date.now()-lastLoad<15000)return;
    loading=true;
    try{summary=await api('study?username='+encodeURIComponent(username));loadedUser=username;lastLoad=Date.now();paint();}
    finally{loading=false;}
  }
  function render(){
    if(!state)return;
    const c=state.config,p=state.dailyProtection;
    $('#protected-daily-budget').textContent=p?`${p.tokens.toLocaleString()} tokens protected for ${p.remaining} remaining allotted questions. QOTD and the full daily count stay mandatory.`:'Daily allowance will appear after the next server update.';
    $('#provider-recovery').textContent=Object.entries(state.providerCooldowns||{}).filter(([,row])=>Date.parse(row.until)>Date.now()).map(([name,row])=>`${name} retries after ${formatDate(row.until,{hour:'2-digit',minute:'2-digit'})}`).join(' · ');
    const f=$('#reliability-settings');if(!f.contains(document.activeElement)){f.elements.dailyReservePerQuestion.value=c.dailyReservePerQuestion||6000;f.elements.providerCooldownSeconds.value=c.providerCooldownSeconds||120;}
    const local=$('#local-ai-settings');if(!local.contains(document.activeElement)){
      const settings=c.localAI||{enabled:false,backend:'ollama',baseUrl:'http://127.0.0.1:11434',model:'',cloudFallback:true,preference:'local-first'};
      for(const key of ['backend','baseUrl','model','preference'])local.elements[key].value=settings[key];for(const key of ['enabled','cloudFallback'])local.elements[key].checked=!!settings[key];local.elements.preference.disabled=!settings.cloudFallback;
    }
    const readiness=state.dailyReadiness;if(readiness)$('#readiness-result').textContent=`Daily readiness (${dateOnly(readiness.date)}): ${formatDate(readiness.checkedAt,{hour:'2-digit',minute:'2-digit'})}. ${readiness.checks.map(row=>(row.ok?'✓ ':'○ ')+row.message).join(' · ')}. Provider generation quota is not guaranteed.`;
    if(['practice','notebook','interview'].includes(page))load().catch(error);
  }
  $('#readiness-check').addEventListener('click',async()=>{try{const result=await api('readiness');state.dailyReadiness=result;render();toast(result.ready?'Daily readiness checks passed.':'Daily practice needs attention. Read the checklist.');}catch(e){error(e);}});
  $('#reliability-settings').addEventListener('submit',event=>{event.preventDefault();const f=event.currentTarget;action(()=>api('config',{dailyReservePerQuestion:Number(f.elements.dailyReservePerQuestion.value),providerCooldownSeconds:Number(f.elements.providerCooldownSeconds.value)}));});
  async function saveLocal(){
    const f=$('#local-ai-settings');await api('config',{localAI:{enabled:f.elements.enabled.checked,backend:f.elements.backend.value,baseUrl:f.elements.baseUrl.value.trim(),model:f.elements.model.value.trim(),cloudFallback:f.elements.cloudFallback.checked,preference:f.elements.preference.value}});
    if(f.elements.key.value){await api('keys',{provider:'local',key:f.elements.key.value});f.elements.key.value='';}
  }
  $('#local-ai-settings').addEventListener('submit',event=>{event.preventDefault();action(saveLocal);});
  $('#local-ai-settings').elements.backend.addEventListener('change',event=>{$('#local-ai-settings').elements.baseUrl.value=event.target.value==='ollama'?'http://127.0.0.1:11434':'http://127.0.0.1:1234/v1';});
  $('#local-ai-settings').elements.cloudFallback.addEventListener('change',event=>{$('#local-ai-settings').elements.preference.disabled=!event.target.checked;});
  $('#local-models').addEventListener('click',async()=>{try{await saveLocal();const result=await api('local-ai/models');$('#local-model-list').innerHTML=result.models.map(id=>`<option value="${esc(id)}"></option>`).join('');$('#local-ai-result').textContent=`${result.models.length} installed models found. Select one and save.`;}catch(e){$('#local-ai-result').textContent=e.message;}});
  $('#local-test').addEventListener('click',async()=>{const button=$('#local-test');button.disabled=true;try{await saveLocal();const result=await api('local-ai/test',{});$('#local-ai-result').textContent=result.message;await refresh();}catch(e){$('#local-ai-result').textContent=e.message;}finally{button.disabled=false;}});
  async function loadQuestion(){await advancedFeatures.loadQuestion();const ctx=context();$('#practice-title').textContent=ctx.problem.title;$('#study-account').value=ctx.username||'';await load(true);return ctx;}
  $('#practice-load').addEventListener('click',()=>loadQuestion().catch(error));
  $('#study-refresh').addEventListener('click',()=>load(true).catch(error));
  $('#notebook-more').addEventListener('click',()=>{notebookLimit+=50;paint();});
  $('#notebook-refresh').addEventListener('click',()=>load(true).catch(error));
  $('#practice-attempt').addEventListener('submit',async event=>{
    event.preventDefault();try{
      const ctx=context().problem?context():await loadQuestion();
      if(!ctx.username)throw Error('Load a signed-in question first');
      const assistedByHistory=Object.values(leetcodeRuns).some(run=>run.date===state.today&&run.username?.toLowerCase()===ctx.username.toLowerCase()&&run.tasks?.some(t=>t.problem?.titleSlug===ctx.problem.titleSlug&&t.solution?.code));
      const result=await api('study/attempt',{username:ctx.username,titleSlug:ctx.problem.titleSlug,title:ctx.problem.title,code:$('#practice-code').value,solved:$('#practice-solved').checked,withoutAI:$('#practice-no-ai').checked,assistedByHistory});
      $('#study-account').value=ctx.username;toast(`Saved as ${result.source}; this is a self-reported result.`);await load(true);
    }catch(e){error(e);}
  });
  $('#mistake-records').addEventListener('submit',async event=>{event.preventDefault();const f=event.target;try{await api('study/note',{username:loadedUser,id:f.dataset.mistakeId,category:f.elements.category.value,note:f.elements.note.value,resolved:f.elements.resolved.checked});toast('Notebook saved');document.activeElement?.blur();await load(true);}catch(e){error(e);}});
  $('#notebook-import').addEventListener('click',async()=>{
    if(!extension){toast('Open the extension to import its past run history.');return;}
    try{const username=account();if(!username)throw Error('Choose an account under My practice first');const {leetcodeRuns={}}=await chrome.storage.local.get('leetcodeRuns');const rows=[];
      for(const run of Object.values(leetcodeRuns))if(run.username?.toLowerCase()===username.toLowerCase())for(const task of run.tasks||[])if(task.status==='accepted'||task.preflightFailures||task.submissionHistory?.some(a=>a.status==='rejected'))rows.push({date:run.date,username,titleSlug:task.problem.titleSlug,title:task.problem.title,topics:task.problem.topics||[],feedback:String(task.feedback||'').slice(0,2000),code:String(task.solution?.code||'').slice(0,3000),accepted:task.status==='accepted',hadFailure:!!task.preflightFailures||task.submissionHistory?.some(a=>a.status==='rejected')});
      for(let i=0;i<rows.length;i+=100)await api('study/mistakes',rows.slice(i,i+100));await load(true);toast('Past mistakes imported; archive copies are deduplicated.');
    }catch(e){error(e);}
  });
  function tick(){
    if(!currentInterview)return;const left=Math.max(0,Date.parse(currentInterview.deadline)-Date.now()),active=currentInterview.status==='active'&&left>0;
    $('#interview-timer').textContent=active?`${Math.floor(left/60000)}:${String(Math.floor(left/1000)%60).padStart(2,'0')} remaining`:'Interview ended';
    $('#interview-status').textContent=`${currentInterview.status} · ${currentInterview.hintsUsed}/${currentInterview.hintLimit} hints used`;
    $('#interview-code').disabled=!active;$('#interview-hint').disabled=working||!active||currentInterview.hintsUsed>=currentInterview.hintLimit;
    $('#interview-finish').disabled=!['active','expired'].includes(currentInterview.status)||!!currentInterview.finishedAt;
    $('#interview-feedback').disabled=working||!currentInterview.finishedAt;
  }
  function showFeedback(result){
    if(!result)return;const element=$('#interview-result');element.replaceChildren();const text=document.createElement('p');text.textContent=result.text||'';element.append(text);
    const feedback=result.feedback;if(!feedback)return;
    for(const [title,rows] of [['Rubric',Object.entries(feedback.rubric||{}).map(([name,score])=>`${name}: ${score}/5`)],['Strengths',feedback.strengths],['Issues',feedback.issues],['Follow-up questions',feedback.followUps]]){const heading=document.createElement('h3');heading.textContent=title;const list=document.createElement('ul');for(const value of rows||[]){const item=document.createElement('li');item.textContent=value;list.append(item);}element.append(heading,list);}
  }
  $('#interview-start').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget;try{const ctx=await loadQuestion();currentInterview=await api('interviews/start',{username:ctx.username,problem:ctx.problem,minutes:Number(f.elements.minutes.value),hintLimit:Number(f.elements.hintLimit.value)});$('#interview-code').value='';$('#interview-result').replaceChildren();await load(true);}catch(e){error(e);}});
  $('#interview-code').addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(async()=>{if(!currentInterview)return;try{await api('interviews/draft',{id:currentInterview.id,username:currentInterview.username,code:$('#interview-code').value});}catch(e){if(Date.now()<Date.parse(currentInterview.deadline))error(e);}},700);});
  $('#interview-hint').addEventListener('click',async()=>{
    if(!currentInterview||working)return;working=true;tick();
    try{const result=await api('learning',{stage:'hint',problem:currentInterview.problem,username:currentInterview.username,interviewId:currentInterview.id,sessionId:'interview:'+currentInterview.id});const p=document.createElement('p');p.textContent='Hint: '+result.text;$('#interview-result').append(p);await load(true);}catch(e){error(e);}finally{working=false;tick();}
  });
  $('#interview-finish').addEventListener('click',async()=>{if(!currentInterview)return;try{clearTimeout(draftTimer);currentInterview=await api('interviews/finish',{id:currentInterview.id,username:currentInterview.username,code:$('#interview-code').value});await load(true);tick();}catch(e){error(e);}});
  $('#interview-feedback').addEventListener('click',async()=>{
    if(!currentInterview||working)return;working=true;tick();
    try{const result=await api('interviews/feedback',{id:currentInterview.id,username:currentInterview.username});showFeedback(result);await load(true);}catch(e){error(e);}finally{working=false;tick();}
  });
  setInterval(tick,1000);
  globalThis.practicePlus={render};
})();
