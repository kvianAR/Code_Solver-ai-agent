import fs from 'node:fs';
import {SERVER_VERSION} from '../server/diagnostics.mjs';
const file=new URL('../data/server.json',import.meta.url);
console.log(`Practice Ex. ${SERVER_VERSION} · Node.js ${process.versions.node}`);
try{
  const {url}=JSON.parse(fs.readFileSync(file));
  const {adminToken}=JSON.parse(fs.readFileSync(new URL('../data/state.json',import.meta.url)));
  const response=await fetch(url+'/api/diagnostics',{headers:{Authorization:`Bearer ${adminToken}`},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Server authentication failed');
  const result=await response.json();
  console.log(`Server: ${url} · version ${result.version}`);
  for(const check of result.checks)console.log(`${check.ok?'OK':'CHECK'} ${check.message}${check.ok?'':' — '+check.action}`);
  if(result.version!==SERVER_VERSION)console.log('CHECK Server update pending. Run npm run setup.');
}catch(error){console.error('CHECK '+error.message+'. Run npm run setup.');process.exitCode=1;}
