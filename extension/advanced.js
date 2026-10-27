(() => {
  let problem=null,learningSession='',learningBusy=false,prepared=null,monitor;
  function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function idle(){if(extension){const result=await chrome.runtime.sendMessage({type:'leetcode-run-status'});if(result?.activeId)throw Error('Finish or stop the current session first');}}
  function render(){
    if(!state)return;
    const c=state.config,f=$('#advanced-settings');
    if(!f.contains(document.activeElement)){
      for(const key of ['additionalChecks','adaptivePractice'])f.elements[key].checked=c[key]!==false;
      for(const key of ['sessionTokenBudget','maxSessionCalls','dailyCostBudgetUSD'])f.elements[key].value=c[key]??(key==='sessionTokenBudget'?100000:key==='maxSessionCalls'?32:0);
      for(const p of ['groq','gemini']){f.elements[p+'Input'].value=c.providerPricing?.[p]?.inputPerMillion??'';f.elements[p+'Output'].value=c.providerPricing?.[p]?.outputPerMillion??'';}
    }
    const profile=practicePlanner.profile(leetcodeRuns,leetcodeAccount,state.today);
    $('#practice-focus').textContent=profile.weakTopics.length?'Focus topics: '+profile.weakTopics.join(', '):'Record practice outcomes to build topic recommendations.';
    $('#revision-due').textContent=`${profile.due.length} questions due for spaced revision. Recommendations use AI-assisted outcomes, not a measurement of your skill.`;
    const usage=state.usage?.[state.today]||{},rows=Object.entries(usage.providers||{});
    $('#usage-breakdown').innerHTML=rows.length?'<table><thead><tr><th>Provider</th><th>Calls</th><th>Tokens</th><th>Estimated USD</th></tr></thead><tbody>'+rows.map(([p,row])=>`<tr><td>${esc(p)}</td><td>${row.calls}</td><td>${row.tokens.toLocaleString()}</td><td>${(row.unpricedCalls||row.unpricedCalls===undefined&&row.calls)?'Unknown / partially priced':'$'+row.estimatedCostUSD.toFixed(4)}</td></tr>`).join('')+'</tbody></table>':'No provider breakdown recorded for this day yet.';
    const sessions=Object.entries(usage.sessions||{}).sort((a,b)=>(b[1].startedAt||'').localeCompare(a[1].startedAt||''));
    $('#usage-breakdown').insertAdjacentHTML('beforeend',`<p class="muted">${sessions.length} recorded sessions · Current limit: ${c.sessionTokenBudget||100000} tokens and ${c.maxSessionCalls||32} AI calls per session.</p>`);
    if(sessions.length)$('#usage-breakdown').insertAdjacentHTML('beforeend','<details><summary>Latest session usage</summary><table><thead><tr><th>Session</th><th>Calls</th><th>Tokens</th><th>Estimated USD</th></tr></thead><tbody>'+sessions.slice(0,5).map(([id,row])=>`<tr><td>${id.startsWith('learning:')?'Learning':id.startsWith('automatic:')?'Daily practice':id.startsWith('provider-test:')?'Provider check':'Manual practice'}</td><td>${row.calls}</td><td>${row.tokens.toLocaleString()}</td><td>${(row.unpricedCalls||row.unpricedCalls===undefined&&row.calls)?'Unknown / partially priced':'$'+row.estimatedCostUSD.toFixed(4)}</td></tr>`).join('')+'</tbody></table></details>');
    const failure=globalThis.failureGuide.explain(dailyDiagnostic?.message||'');
    $('#failure-action').textContent=['blocked','failed','connection','login','provider'].includes(dailyDiagnostic?.kind)?failure.summary+' '+failure.action:'';
    $('#browser-self-check').disabled=!extension;
  }
  async function loadQuestion(){
    if(!extension)throw Error('Open the Practice Ex. extension to load a LeetCode question');
    const response=await chrome.runtime.sendMessage({type:'learning-current-question'});if(!response?.ok)throw Error(response?.error||'Could not load the question');
    problem=response.problem;learningSession='learning:'+crypto.randomUUID();
    $('#learn-title').textContent=problem.title;$('#learn-statement').textContent=problem.statement.slice(0,1200);$('#learn-output').replaceChildren();
  }
  $('#learn-load').addEventListener('click',()=>loadQuestion().catch(error=>toast(error.message)));
  $('#page-learn').addEventListener('click',async event=>{
    const stage=event.target.dataset.learn;if(!stage||learningBusy)return;
    learningBusy=true;document.querySelectorAll('[data-learn]').forEach(b=>b.disabled=true);
    try{
      if(!problem)await loadQuestion();
      const result=await api('learning',{problem,stage,code:$('#learn-code').value,sessionId:learningSession});
      const heading=document.createElement('h3');heading.textContent=stage==='solution'?'Full solution':stage==='review'?'Code review':stage==='hint'?'Hint':'Approach';
      const content=document.createElement(result.code?'pre':'p');content.textContent=result.code||result.text;
      const note=document.createElement('p');note.className='muted';note.textContent=`${result.provider} · ${result.usage?.tokens??'Estimated'} tokens. AI advice can be wrong; no submission was sent.`;
      $('#learn-output').replaceChildren(heading,content,note);await refresh();
    }catch(error){toast(error.message);}finally{learningBusy=false;document.querySelectorAll('[data-learn]').forEach(b=>b.disabled=false);}
  });
  $('#advanced-settings').addEventListener('submit',event=>{
    event.preventDefault();const f=event.currentTarget;
    action(async()=>{
      const pricing={};for(const p of ['groq','gemini']){const input=f.elements[p+'Input'].value,output=f.elements[p+'Output'].value;if((input==='')!==(output===''))throw Error('Enter both input and output prices, or leave both blank');pricing[p]=input===''?null:{inputPerMillion:Number(input),outputPerMillion:Number(output)};}
      await api('config',{additionalChecks:f.elements.additionalChecks.checked,adaptivePractice:f.elements.adaptivePractice.checked,sessionTokenBudget:Number(f.elements.sessionTokenBudget.value),maxSessionCalls:Number(f.elements.maxSessionCalls.value),dailyCostBudgetUSD:Number(f.elements.dailyCostBudgetUSD.value),providerPricing:pricing});
    });
  });
  $('#browser-self-check').addEventListener('click',async()=>{
    $('#browser-self-check').disabled=true;
    try{const response=await chrome.runtime.sendMessage({type:'extension-self-check'});if(!response?.ok)throw Error(response?.error||'Browser check failed');$('#browser-check-result').textContent=response.report.checks.map(c=>`${c.id}: ${c.status}${c.message?' — '+c.message:''}`).join(' · ');}
    catch(error){toast(error.message);}finally{$('#browser-self-check').disabled=!extension;}
  });
  $('#export-backup').addEventListener('click',async()=>{
    try{const backup=await api('backup');if(extension){const {leetcodeRuns={}}=await chrome.storage.local.get('leetcodeRuns');backup.extensionRuns=portableData.clean(leetcodeRuns);}download('practice-ex-backup-'+state.today+'.json',backup);toast('Backup exported without provider keys or connection credentials.');}catch(error){toast(error.message);}
  });
  $('#restore-backup').addEventListener('click',async()=>{
    try{
      await idle();const file=$('#restore-file').files[0];if(!file||file.size>20e6)throw Error('Select a JSON backup smaller than 20 MB');
      const backup=JSON.parse(await file.text()),imported=portableData.runs(backup.extensionRuns||{});
      let merged;
      if(extension){const {leetcodeRuns={}}=await chrome.storage.local.get('leetcodeRuns');merged={...imported,...leetcodeRuns};const bytes=new TextEncoder().encode(JSON.stringify(merged)).length;const [total,current]=await Promise.all([chrome.storage.local.getBytesInUse(null),chrome.storage.local.getBytesInUse('leetcodeRuns')]);if(total-current+bytes+1024>(chrome.storage.local.QUOTA_BYTES||10485760))throw Error('Merged extension history exceeds its storage allowance');}
      else if(Object.keys(imported).length)throw Error('Restore this backup in the extension dashboard to include browser history');
      const result=await api('restore',backup);
      if(extension){await chrome.storage.local.set({leetcodeRuns:merged});await chrome.runtime.sendMessage({type:'poll'}).catch(()=>{});}
      toast(result.message);await refresh();
    }catch(error){toast(error.message);}
  });
  $('#support-report').addEventListener('click',async()=>{
    try{
      const report=await api('support-report');
      if(extension){const saved=await chrome.storage.local.get('extensionSelfCheck');report.browserChecks=(saved.extensionSelfCheck?.checks||[]).map(row=>({id:row.id,status:row.status}));report.runCounts=Object.values(leetcodeRuns).reduce((counts,run)=>{const key=['completed','review','blocked','failed','stopped','interrupted','running','discovering'].includes(run.status)?run.status:'other';counts[key]=(counts[key]||0)+1;return counts;},{});}
      download('practice-ex-diagnostics-'+state.today+'.json',report);
    }catch(error){toast(error.message);}
  });
  async function updateRequest(route,value,confirmation){
    const response=await fetch(connection.url+'/api/updates/'+route,{method:'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':route==='prepare'?'application/zip':'application/json',...(confirmation?{'X-Practice-Update':confirmation}:{})},body:route==='prepare'?value:JSON.stringify(value),signal:AbortSignal.timeout(30000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Update failed');return result;
  }
  function watchUpdate(version){
    clearInterval(monitor);let attempts=0;const started=Date.now(),before=state.serverVersion;
    monitor=setInterval(async()=>{
      attempts++;
      try{const latest=await api('state');let updates={};try{updates=await api('updates');}catch{}if(latest.serverVersion===version&&(version!==before||updates.status?.phase==='complete'&&Date.parse(updates.status.at)>=started)){clearInterval(monitor);state=latest;renderSetup();$('#update-status').textContent=`Server ${version} is ready. Reload the extension in chrome://extensions to finish.`;return;}if(['failed','rolled-back'].includes(updates.status?.phase)){clearInterval(monitor);$('#update-status').textContent='The update could not complete. The previous code was restored; check local update logs.';}
      }catch{}
      if(attempts>=60){clearInterval(monitor);$('#update-status').textContent='The server has not returned yet. Open Start Practice Ex.command and check setup.';}
    },2000);
  }
  $('#prepare-update').addEventListener('click',async()=>{
    try{await idle();const file=$('#update-file').files[0];if(!file||file.size>50e6)throw Error('Select a release ZIP smaller than 50 MB');prepared=await updateRequest('prepare',file);$('#update-plan').textContent=`Checked version ${prepared.version}: ${prepared.files} entries. Installation backs up the current code and settings, restarts the server and preserves current history and keys.`;$('#install-update').hidden=false;}catch(error){prepared=null;$('#install-update').hidden=true;toast(error.message);}
  });
  $('#install-update').addEventListener('click',async()=>{
    if(!prepared)return;
    try{await idle();await updateRequest('install',{id:prepared.id},'install');$('#update-status').textContent='Installing checked release. Waiting for the local server…';$('#install-update').hidden=true;watchUpdate(prepared.version);}catch(error){toast(error.message);}
  });
  $('#list-rollbacks').addEventListener('click',async()=>{
    try{const result=await api('updates');$('#rollback-id').innerHTML=result.snapshots.map(row=>`<option value="${esc(row.id)}" data-version="${esc(row.version)}">${esc(row.version)} · ${esc(row.createdAt)}</option>`).join('');if(!result.snapshots.length)toast('Restore points are created before an update or rollback.');}catch(error){toast(error.message);}
  });
  $('#rollback-update').addEventListener('click',async()=>{
    try{await idle();const select=$('#rollback-id'),id=select.value;if(!id)throw Error('Load and choose a restore point first');const version=select.selectedOptions[0].dataset.version;await updateRequest('rollback',{id},'rollback');$('#update-status').textContent='Restoring selected code version. Current history and keys are preserved.';watchUpdate(version);}catch(error){toast(error.message);}
  });
  globalThis.advancedFeatures={render};
  if(location.hash==='#learn'){
    document.querySelector('nav [data-page="learn"]').click();
    if(extension)chrome.storage.local.get('learningProblem').then(saved=>{if(saved.learningProblem){problem=saved.learningProblem;learningSession='learning:'+crypto.randomUUID();$('#learn-title').textContent=problem.title;$('#learn-statement').textContent=problem.statement.slice(0,1200);}});
  }
})();
