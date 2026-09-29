import {spawn,execFile} from 'node:child_process';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export function judgeResults(outputs,tests) {
  if (!Array.isArray(outputs)||outputs.length!==tests.length) return {accepted:false,feedback:'Output must contain one result per input'};
  const i=tests.findIndex((t,n)=>!isDeepStrictEqual(t.expected,outputs[n]));
  return i<0?{accepted:true,feedback:`Passed ${tests.length} test cases`}:{accepted:false,feedback:`Wrong Answer on test ${i+1}: input ${JSON.stringify(tests[i].input)}, expected ${JSON.stringify(tests[i].expected)}, received ${JSON.stringify(outputs[i]).slice(0,500)}`};
}
export async function dockerJudge(code,language,tests,limits) {
  const name='solver-'+crypto.randomBytes(10).toString('hex');
  const inputs=tests.map(t=>t.input);
  const script=language==='python'
    ?`import json\nnamespace={}\nexec(${JSON.stringify(code)}, namespace)\ninputs=json.loads(${JSON.stringify(JSON.stringify(inputs))})\nprint(json.dumps([namespace['solve'](data) for data in inputs]))\n`
    :`${code}\nconst __inputs = ${JSON.stringify(inputs)};\nconsole.log(JSON.stringify(__inputs.map(data => solve(data))));\n`;
  const args=['run','--rm','-i','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory',`${limits.memoryMB}m`,'--cpus',String(limits.cpus),'--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--pull','never',language==='python'?'python:3.12-alpine':'node:22-alpine',...(language==='python'?['python','-I','-']:['node','-'])];
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='',settled=false;
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});
    const remove=()=>{const cleanup=spawn('docker',['rm','-f',name],{stdio:'ignore'});cleanup.on('error',()=>{});};
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(result);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');remove();finish(null,{accepted:false,feedback:'Time Limit Exceeded'});},limits.timeoutSeconds*1000);
    child.on('error',()=>finish(Error('Docker judge unavailable. Install Docker and pull the runner images.')));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',d=>{stdout+=d;if(stdout.length>100000){child.kill('SIGKILL');remove();finish(null,{accepted:false,feedback:'Output limit exceeded'});}});
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000);});
    child.on('close',status=>{
      if(settled)return;
      if(status===125||status===127) {finish(Error('Docker runner image or daemon unavailable; check setup'));return;}
      if(status!==0){finish(null,{accepted:false,feedback:`Runtime Error: ${stderr.slice(-1200)}`});return;}
      try {finish(null,judgeResults(JSON.parse(stdout.trim()),tests));}catch{finish(null,{accepted:false,feedback:'Invalid output; return values from solve(data), do not print'});}
    });
    child.stdin.end(script);
  });
}
dockerJudge.ready=async language=>{
  const command=args=>new Promise((resolve,reject)=>execFile('docker',args,{timeout:10000,maxBuffer:10000},(error)=>error?reject(Error('Docker judge not ready. Start Docker and pull '+(language==='python'?'python:3.12-alpine':'node:22-alpine')+'.')):resolve()));
  await command(['info','--format','{{.ServerVersion}}']);
  await command(['image','inspect',language==='python'?'python:3.12-alpine':'node:22-alpine']);
};

export async function dockerSyntaxCheck(code,language,limits) {
  const name='draft-check-'+crypto.randomBytes(10).toString('hex');
  const script=language==='python'
    ?`code=${JSON.stringify(code)}\ncompile(code, 'solution.py', 'exec')\nprint('Syntax check passed')\n`
    :`new Function(${JSON.stringify(code)}); console.log('Syntax check passed');\n`;
  const image=language==='python'?'python:3.12-alpine':'node:22-alpine';
  const command=language==='python'?['python','-I','-']:['node','-'];
  const args=['run','--rm','-i','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory',`${limits.memoryMB}m`,'--cpus',String(limits.cpus),'--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=8m','--pull','never',image,...command];
  return new Promise((resolve,reject)=>{
    let stderr='',settled=false;
    const child=spawn('docker',args,{stdio:['pipe','ignore','pipe']});
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(null,{ok:false,feedback:'Syntax check timed out'});},Math.min(10,limits.timeoutSeconds)*1000);
    child.on('error',()=>finish(Error('Docker syntax checker unavailable')));
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-2000);});
    child.on('close',status=>finish(null,status===0?{ok:true,feedback:'Syntax check passed'}:{ok:false,feedback:`Syntax error: ${stderr.trim().slice(-1200)}`}));
    child.stdin.end(script);
  });
}

export async function localSyntaxCheck(code,language,limits) {
  const command=language==='python'?'python3':process.execPath;
  const args=language==='python'
    ?['-I','-c',"import sys; compile(sys.stdin.read(), 'solution.py', 'exec')"]
    :['--check','-'];
  return new Promise((resolve,reject)=>{
    let stderr='',settled=false;
    const child=spawn(command,args,{stdio:['pipe','ignore','pipe']});
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(null,{ok:false,feedback:'Syntax check timed out'});},Math.min(10,limits.timeoutSeconds)*1000);
    child.on('error',()=>finish(Error(`${language==='python'?'Python':'Node.js'} syntax checker unavailable`)));
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-2000);});
    child.on('close',status=>finish(null,status===0?{ok:true,feedback:'Local syntax check passed'}:{ok:false,feedback:`Syntax error: ${stderr.trim().slice(-1200)}`}));
    child.stdin.end(code);
  });
}
