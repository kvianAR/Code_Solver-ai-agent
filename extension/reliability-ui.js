(() => {
  let healthAt=0,healthBusy=false,report=null;
  const account=id=>$(id).value.trim()||leetcodeAccount||$('#study-account').value.trim();
  function healthRows(checks){$('#connection-health').innerHTML=checks.map(row=>`<p><strong>${row.ok?'✓':'○'} ${esc({extension:'Extension',server:'Agent server',login:'LeetCode login',ai:'AI providers'}[row.id]||row.id)}</strong> · ${esc(row.message)}</p>`).join('');}
  async function health(force=false){
    if(healthBusy||!force&&Date.now()-healthAt<15000)return;
    healthBusy=true;
    try{
      if(extension){
        const result=await chrome.runtime.sendMessage({type:'connection-health',refresh:force});if(!result?.ok)throw Error(result?.error||'Background health check unavailable');
        healthRows(result.checks);const r=result.recovery;
        $('#wake-recovery').textContent=r?`Last missed-run recovery: ${formatDate(r.resumedAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}. Retained ${r.acceptedRetained} accepted daily questions for ${r.username}.`:'';
      }else healthRows([{id:'server',ok:!!state,message:state?'Connected through this dashboard':'Connection unavailable'},{id:'extension',ok:false,message:'Open the extension for browser login, background recovery and account checks'}]);
      healthAt=Date.now();
    }catch(e){healthRows([{id:'extension',ok:false,message:e.message}]);}
    finally{healthBusy=false;}
  }
  function render(){
    if(!state)return;
    $('#health-reconnect').disabled=!extension;
    $('#apply-installed-update').disabled=!extension;
    const profiles=state.extensionHealth||[],latest=[...profiles].sort((a,b)=>b.seenAt.localeCompare(a.seenAt))[0];
    $('#installed-version-health').textContent=extension?`Installed extension ${chrome.runtime.getManifest().version} · Server ${state.serverVersion}. ${chrome.runtime.getManifest().version===state.serverVersion?'Versions match.':'Apply the installed update while no run is active.'}`:latest?`Last extension heartbeat: ${latest.version} · ${latest.fresh?'recent':'stale'} · ${latest.versionMatches?'version matches':'update required'} · ${latest.accepted}/${latest.target} accepted · ${latest.status} · ${latest.reason}.`:'No extension heartbeat received yet. Reload the installed extension; a server update alone does not reload Chrome.';
    for(const id of ['#revision-account','#weekly-account'])if(!$(id).value&&leetcodeAccount)$(id).value=leetcodeAccount;
    if(page==='today')health().catch(e=>toast(e.message));
  }
  function offline(){healthAt=0;if(extension)health();else healthRows([{id:'server',ok:false,message:'Server connection unavailable. Start Practice Ex. and reconnect.'}]);}
  $('#health-check').addEventListener('click',()=>health(true));
  $('#health-reconnect').addEventListener('click',async()=>{
    const button=$('#health-reconnect');button.disabled=true;
    try{const result=await chrome.runtime.sendMessage({type:'connect-local-agent'});if(!result?.ok||!result.connected)throw Error(result?.error||'Start Practice Ex. on this Mac first');connection=await loadConnection();await health(true);await refresh();toast('Agent reconnected; daily safety checks remain active.');}catch(e){toast(e.message);}finally{button.disabled=!extension;}
  });
  $('#apply-installed-update').addEventListener('click',async()=>{
    try{const status=await chrome.runtime.sendMessage({type:'leetcode-run-status'});if(!status?.ok)throw Error('Extension background is unavailable. Reload Practice Ex. in chrome://extensions.');if(status.activeId)throw Error('Finish or Stop the active run before applying an update. Saved history and daily limits are preserved.');toast('Applying installed extension code. Reopen the popup, then refresh existing LeetCode tabs.');setTimeout(()=>chrome.runtime.reload(),400);}catch(e){toast(e.message);}
  });
  $('#live-report-download').addEventListener('click',async()=>{
    try{
      if(extension){await chrome.runtime.sendMessage({type:'extension-live-report'}).catch(()=>{});}
      const latest=await api('state'),value={version:latest.serverVersion,createdAt:new Date().toISOString(),extensionHealth:latest.extensionHealth||[],providers:Object.fromEntries(Object.entries(latest.providers||{}).map(([name,row])=>[name,{configured:row.configured,status:latest.providerHealth?.[name]?.status||'untested',checkedAt:latest.providerHealth?.[name]?.checkedAt||null,retryAt:latest.providerCooldowns?.[name]?.until||null}])),dailyReserve:latest.dailyProtection};
      const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`practice-ex-live-check-${latest.today}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){toast(e.message);}
  });
  $('#revision-load').addEventListener('click',async()=>{
    try{
      const username=account('#revision-account');if(!username)throw Error('Enter a history account first');$('#revision-account').value=username;
      const result=await api('study/revision?username='+encodeURIComponent(username));
      if(account('#revision-account')!==username)return;
      $('#revision-feedback').hidden=true;
      $('#revision-summary').textContent=`${username}: ${result.questions.length} due quizzes. First answers are recorded once per question per day.`;
      $('#revision-questions').innerHTML=result.questions.map(row=>`<form class="card" data-quiz-id="${esc(row.id)}" data-quiz-user="${esc(username)}"><h2>${esc(row.title)}</h2><p><a href="https://leetcode.com/problems/${esc(row.titleSlug)}/" target="_blank" rel="noopener noreferrer">Practise this question again</a></p><p>${esc(row.context)}</p><p>${esc(row.question)}</p><label>Mistake type<select name="answer" required><option value="">Choose your answer</option>${row.options.map(option=>`<option value="${esc(option)}">${esc(option)}</option>`).join('')}</select></label><button>Check and reveal saved lesson</button></form>`).join('')||'<div class="card">No quizzes due. Record mistakes in the notebook first. Correct answers return in three days; missed answers return tomorrow.</div>';
    }catch(e){toast(e.message);}
  });
  $('#revision-questions').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('button');button.disabled=true;
    try{
      const result=await api('study/revision',{id:form.dataset.quizId,username:form.dataset.quizUser,answer:form.elements.answer.value});
      const output=$('#revision-feedback');output.hidden=false;output.replaceChildren();
      for(const text of [result.correct?'Correct recall.':'Review this mistake again.',`Recorded answer: ${result.recordedCorrect?'correct':'needs revision'}. Type: ${result.category}.`,result.feedback,result.note,`Next review: ${result.nextReview}. ${result.verification}`]){const p=document.createElement('p');p.textContent=text;output.append(p);}
      if(result.codeSnippet){const details=document.createElement('details'),label=document.createElement('summary'),code=document.createElement('pre');label.textContent='Saved attempt';code.textContent=result.codeSnippet;details.append(label,code);output.append(details);}
      form.remove();
    }catch(e){toast(e.message);button.disabled=false;}
  });
  $('#weekly-load').addEventListener('click',async()=>{
    report=null;$('#weekly-download').disabled=true;
    try{
      const username=account('#weekly-account');if(!username)throw Error('Enter a history account first');$('#weekly-account').value=username;
      const result=await api('study/weekly?username='+encodeURIComponent(username));if(account('#weekly-account')!==username)return;report=result;
      $('#weekly-report').innerHTML=`<div class="card"><h2>${esc(result.username)} · ${esc(result.from)} to ${esc(result.to)}</h2><p>${result.completedDays} complete daily allotments · ${result.recordedDays}/7 days have synced daily records.</p><div style="overflow-x:auto"><table><thead><tr><th>Local date</th><th>Daily accepted</th><th>QOTD</th><th>Independent solved / attempts</th><th>Assisted attempts</th><th>Quiz recall</th></tr></thead><tbody>${result.days.map(day=>`<tr><td>${esc(day.date)}</td><td>${day.accepted===null?'Unknown':day.accepted+'/'+day.target}${day.targetEstimated?' (target estimated)':''}</td><td>${day.accepted===null?'Unknown':day.qotdAccepted?'Accepted':day.qotdExempt==='already-accepted'?'Already solved':['three-approaches-failed','draft-preparation-failed'].includes(day.qotdExempt)?'Replaced after 3 approaches':'Pending'}</td><td>${day.independentSolved}/${day.independentAttempts}</td><td>${day.assistedAttempts}</td><td>${day.quizCorrect}/${day.quizAttempts}</td></tr>`).join('')}</tbody></table></div></div><div class="card"><h2>Recorded mistake patterns</h2>${result.repeatedMistakes.length?'<ul>'+result.repeatedMistakes.map(row=>`<li>${esc(row.category)}: ${row.count}</li>`).join('')+'</ul>':'<p>No recorded mistakes this week.</p>'}${result.notes.map(note=>`<p class="muted">${esc(note)}</p>`).join('')}</div>`;
      $('#weekly-download').disabled=false;
    }catch(e){$('#weekly-report').replaceChildren();toast(e.message);}
  });
  $('#weekly-account').addEventListener('input',()=>{report=null;$('#weekly-download').disabled=true;$('#weekly-report').replaceChildren();});
  $('#revision-account').addEventListener('input',()=>{$('#revision-questions').replaceChildren();$('#revision-feedback').hidden=true;});
  $('#weekly-download').addEventListener('click',()=>{
    if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`practice-ex-weekly-${report.to}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  globalThis.reliabilityFeatures={render,offline};
})();
