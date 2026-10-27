(() => {
  async function run(io){
    const checks=[];
    const check=async(id,action)=>{try{await action();checks.push({id,status:'pass'});}catch(error){checks.push({id,status:'fail',message:globalThis.failureGuide?.explain(error.message).action||'Check setup and retry'});}};
    await check('host-permission',async()=>{if(!await io.permission())throw Error('connection permission');});
    await check('automatic-pairing',()=>io.connect());
    await check('authenticated-server',async()=>{const state=await io.state();if(!state?.config)throw Error('connection unavailable');if(state.serverVersion!==io.version)throw Error('model version mismatch');});
    await check('leetcode-session',async()=>{if(!await io.session())throw Error('Sign in to LeetCode');});
    checks.push({id:'browser-restart-reconnection',status:'manual',message:'Restart Chrome, then run this check again.'});
    checks.push({id:'account-change-and-offline-recovery',status:'manual',message:'Account switching and offline recovery have automated regression tests; verify them in your browser profile.'});
    return {version:io.version,at:new Date().toISOString(),checks};
  }
  globalThis.extensionSelfCheck={run};
})();
