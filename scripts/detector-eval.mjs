import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function validateSamples(value) {
  if (!Array.isArray(value) || !value.length) throw Error('Samples must be a non-empty JSON array');
  const seen=new Set();
  return value.map((sample,index)=>{
    if(!sample||typeof sample.id!=='string'||!sample.id.trim()||seen.has(sample.id))throw Error(`Sample ${index+1} needs a unique id`);
    if(!['human','ai'].includes(sample.expected))throw Error(`Sample ${sample.id} needs expected: human or ai`);
    if(typeof sample.code!=='string'||!sample.code.trim()||sample.code.length>100000)throw Error(`Sample ${sample.id} needs code under 100 KB`);
    seen.add(sample.id);
    return {id:sample.id,expected:sample.expected,code:sample.code};
  });
}

export function classify(score,threshold=0.5) {
  if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>1)throw Error('Detector response needs a numeric score from 0 to 1');
  return score>=threshold?'ai':'human';
}

export function summarize(results) {
  const counts={truePositive:0,falsePositive:0,trueNegative:0,falseNegative:0};
  for(const row of results){
    if(row.expected==='ai'&&row.predicted==='ai')counts.truePositive++;
    else if(row.expected==='human'&&row.predicted==='ai')counts.falsePositive++;
    else if(row.expected==='human'&&row.predicted==='human')counts.trueNegative++;
    else counts.falseNegative++;
  }
  const ratio=(a,b)=>b?a/b:null;
  return {...counts,total:results.length,
    accuracy:ratio(counts.truePositive+counts.trueNegative,results.length),
    precision:ratio(counts.truePositive,counts.truePositive+counts.falsePositive),
    recall:ratio(counts.truePositive,counts.truePositive+counts.falseNegative),
    falsePositiveRate:ratio(counts.falsePositive,counts.falsePositive+counts.trueNegative)};
}

export async function evaluate(samples,endpoint,{threshold=0.5,key='',fetcher=fetch}={}) {
  const url=new URL(endpoint);
  if(!['http:','https:'].includes(url.protocol))throw Error('Detector endpoint must use HTTP or HTTPS');
  if(typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('Threshold must be between 0 and 1');
  const results=[];
  for(const sample of validateSamples(samples)){
    const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json',...(key?{authorization:`Bearer ${key}`}:{})},body:JSON.stringify({id:sample.id,code:sample.code}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Detector failed for ${sample.id} (${response.status})`);
    const data=await response.json();
    const predicted=classify(data.score,threshold);
    results.push({id:sample.id,expected:sample.expected,predicted,score:data.score});
  }
  return {threshold,summary:summarize(results),results};
}

function option(name){const i=process.argv.indexOf(name);return i<0?'':process.argv[i+1]||'';}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  try{
    const file=option('--samples'),endpoint=option('--endpoint'),threshold=option('--threshold')?Number(option('--threshold')):0.5;
    if(!file||!endpoint)throw Error('Usage: npm run detector:eval -- --samples labeled.json --endpoint http://127.0.0.1:PORT/detect [--threshold 0.5]');
    const samples=JSON.parse(fs.readFileSync(file,'utf8'));
    const report=await evaluate(samples,endpoint,{threshold,key:process.env.DETECTOR_API_KEY||''});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
