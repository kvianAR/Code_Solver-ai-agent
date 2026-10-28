export function retryTime(error,now=Date.now(),failures=0){
  const supplied=Date.parse(error?.retryAt||'');
  const fallback=now+Math.min(15*60000,60000*2**Math.min(4,Math.max(0,failures)));
  return new Date(Number.isFinite(supplied)&&supplied>now?supplied: fallback).toISOString();
}
export function bridgeError(response,fallback){
  const error=Error(response?.error||fallback);
  for(const key of ['retryAt','kind','checkpoint','submissionSent'])if(response?.[key]!==undefined)error[key]=response[key];
  return error;
}
export const temporaryFailure=error=>error?.kind==='rate'||error?.kind==='temporary'||/\b429\b|\b5\d\d\b|timed out|timeout|network|fetch failed|failed to fetch|connection failed|temporar/i.test(error?.message||'');
