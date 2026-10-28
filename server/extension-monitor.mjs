const statuses=new Set(['idle','pending','solving','stopping','discovering','running','drafting','checking','testing','submitting','queued','retrying','waiting','blocked','failed','stopped','interrupted','completed','review','skipped','prepared']);
const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
export function recordHeartbeat(store,input,now=Date.now()){
  if(!input||!/^\w[\w-]{7,79}$/.test(input.instanceId||'')||!version(input.version)||!statuses.has(input.status)||!statuses.has(input.stage)||!Number.isInteger(input.accepted)||input.accepted<0||input.accepted>100||!Number.isInteger(input.target)||input.target<0||input.target>100)throw Error('Invalid extension heartbeat');
  const retryAt=input.retryAt&&Number.isFinite(Date.parse(input.retryAt))?new Date(input.retryAt).toISOString():'';
  const reason=['none','provider','output','rate','login','budget','contest','submission','connection','solution','skip-limit'].includes(input.reason)?input.reason:'none';
  store.state.extensionHealth||={};
  const record={instanceId:input.instanceId,version:input.version,status:input.status,stage:input.stage,accepted:input.accepted,target:input.target,reason,retryAt,seenAt:new Date(now).toISOString()};
  store.state.extensionHealth[input.instanceId]=record;
  const recent=Object.values(store.state.extensionHealth).filter(row=>Date.parse(row.seenAt)>now-7*86400000).sort((a,b)=>b.seenAt.localeCompare(a.seenAt)).slice(0,8);
  store.state.extensionHealth=Object.fromEntries(recent.map(row=>[row.instanceId,row]));store.save();return {ok:true};
}
export function extensionHealth(store,serverVersion,now=Date.now()){
  return Object.values(store.state.extensionHealth||{}).map(row=>({...row,fresh:now-Date.parse(row.seenAt)<180000,versionMatches:row.version===serverVersion}));
}
