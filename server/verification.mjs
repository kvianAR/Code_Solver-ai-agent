import {execFile} from 'node:child_process';
import {localSyntaxCheck} from './runner.mjs';
export async function verifyDraft(code,starter,language,limits){
  const syntax=await localSyntaxCheck(code,language,limits);if(!syntax.ok||!starter)return syntax;
  if(language==='javascript'){
    const name=starter.match(/(?:var|let|const)\s+(\w+)\s*=\s*(?:async\s+)?function/)?.[1]||starter.match(/function\s+(\w+)\s*\(/)?.[1];
    const declarations=code.replace(/(['"`])(?:\\[\s\S]|(?!\1)[\s\S])*?\1|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,' ');
    const declaration=name&&new RegExp('(?:function|class)\\s+'+name+'\\b|(?:var|let|const)\\s+'+name+'\\s*=\\s*(?:async\\s+)?(?:function\\b|(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>)');
    if(name&&!declaration.test(declarations))return {ok:false,feedback:`Missing required function ${name}`};
    return {...syntax,signatureChecked:!!name};
  }
  const script="import ast,json,sys,re\ns,c=json.load(sys.stdin)\ndef names(x,stub=False):\n if stub:\n  lines=x.splitlines();filled=[]\n  for i,line in enumerate(lines):\n   filled.append(line)\n   if re.match(r\"^\\s*(?:async\\s+)?def\\s+\\w+.*:\\s*(?:#.*)?$\",line):\n    indent=len(line)-len(line.lstrip());following=next((v for v in lines[i+1:] if v.strip() and not v.lstrip().startswith('#')),None)\n    if following is None or len(following)-len(following.lstrip())<=indent:filled.append(' '*(indent+4)+'pass')\n  x='\\n'.join(filled)\n t=ast.parse(x)\n return {(n.name,f.name,len(f.args.args)) for n in t.body if isinstance(n,ast.ClassDef) for f in n.body if isinstance(f,ast.FunctionDef) and (not f.name.startswith('_') or f.name=='__init__')}\ntry:\n expected=names(s,True);actual=names(c);ok=expected.issubset(actual)\n print(json.dumps({'ok':ok,'signatureChecked':bool(expected),'feedback':'Signature check passed' if ok else 'Keep the required class, method name and parameter count from starter code'}))\nexcept SyntaxError:\n print(json.dumps({'ok':True,'signatureChecked':False,'feedback':'Syntax passed; starter signature could not be parsed'}))";
  return new Promise((resolve,reject)=>{
    const child=execFile('python3',['-I','-c',script],{timeout:5000,maxBuffer:10000},(error,stdout)=>{
      if(error){reject(Error('Signature checker unavailable'));return;}
      try{resolve(JSON.parse(stdout));}catch{reject(Error('Invalid signature check response'));}
    });child.stdin.end(JSON.stringify([starter,code]));
  });
}
