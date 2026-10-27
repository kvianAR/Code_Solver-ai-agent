import {catalog} from './catalog.mjs';
import {requestJSON} from './providers.mjs';
export class Platform {
  constructor(store,judge){this.store=store;this.judge=judge;}
  async call(route,body) {
    const c=this.store.state.config;
    const key=this.store.secret('platform');
    return requestJSON(c.platform.baseUrl.replace(/\/$/,'')+route,{headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})},c.requestTimeoutSeconds*1000);
  }
  async problems() {return this.store.state.config.platform.type==='sandbox'?structuredClone(catalog):this.call('/problems');}
  async daily(date) {
    if(this.store.state.config.platform.type==='http') return this.call('/daily?date='+date);
    const day=Math.floor(new Date(date+'T00:00:00Z').getTime()/86400000);
    return structuredClone(catalog[((day%catalog.length)+catalog.length)%catalog.length]);
  }
  async contests() {return this.store.state.config.platform.type==='sandbox'?structuredClone(this.store.state.contests):this.call('/contests');}
  async submit(problem,solution,language,idempotencyKey) {
    if(this.store.state.config.platform.type==='http') {
      let r;
      try{r=await this.call('/submissions',{problemId:problem.id,code:solution.code,language,idempotencyKey});}catch(e){throw Error('Question platform submission failed: '+e.message+'. Check platform connection/key.');}
      if(r.accepted!==true&&r.accepted!==false) throw Error('Platform must return final accepted true/false; pending results are not completion');
      return r;
    }
    if(!Array.isArray(problem.tests)||!problem.tests.length) throw Error('Sandbox problem has no judge tests');
    return {...await this.judge(solution.code,language,problem.tests,this.store.state.config.judge),submissionId:idempotencyKey};
  }
}
