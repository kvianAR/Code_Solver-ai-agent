import {contestRefreshDue,normalizeContestCalendar} from '../extension/contest-calendar.js';

const QUERY='query contestCalendar { allContests { title titleSlug startTime duration } }';

export async function refreshOfficialContests(store,{force=false,now=Date.now(),fetcher=fetch}={}) {
  const cache=store.state.contestCalendar ||= {events:[],updatedAt:0,failedAt:0,error:''};
  if(!force&&!contestRefreshDue(cache.updatedAt,now))return cache;
  if(!force&&now-cache.failedAt<3600000)return cache;
  try{
    const response=await fetcher('https://leetcode.com/graphql/',{
      method:'POST',headers:{'content-type':'application/json','referer':'https://leetcode.com/contest/'},
      body:JSON.stringify({query:QUERY}),signal:AbortSignal.timeout(30000)
    });
    if(!response.ok)throw Error(`LeetCode calendar returned ${response.status}`);
    const data=await response.json();
    if(data.errors?.length||!Array.isArray(data.data?.allContests))throw Error('LeetCode calendar response was incomplete');
    const previous=Object.fromEntries(cache.events.map(c=>[c.id,c]));
    cache.events=normalizeContestCalendar(data.data.allContests,now).map(c=>({...c,openedAt:previous[c.id]?.openedAt||'',reminders:previous[c.id]?.reminders||{}}));
    cache.updatedAt=now;cache.failedAt=0;cache.error='';
  }catch(error){cache.failedAt=now;cache.error=error.message;}
  store.save();
  return cache;
}
