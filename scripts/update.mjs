import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyArchive,applyRollback,listSnapshots} from '../server/releases.mjs';
import crypto from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2);
const lock=path.join(root,'data','update.lock');let ownsLock=false;
try{
  if(process.env.DATA_DIR&&path.resolve(process.env.DATA_DIR)!==path.join(root,'data'))throw Error('Managed updates do not support a custom data directory; back it up before a manual code update');
  if(['--archive','--rollback'].includes(args[0])){
    fs.mkdirSync(path.dirname(lock),{recursive:true,mode:0o700});
    const supplied=args.indexOf('--lock');
    if(supplied>=0){if(fs.readFileSync(lock,'utf8')!==args[supplied+1])throw Error('Update lock does not match');}
    else fs.writeFileSync(lock,crypto.randomUUID(),{flag:'wx',mode:0o600});
    ownsLock=true;
  }
  if(args[0]==='--archive'&&args[1]){const file=path.resolve(args[1]);console.log(JSON.stringify(applyArchive(root,file)));if(path.dirname(file)===path.join(root,'data','pending-updates')){fs.rmSync(file,{force:true});fs.rmSync(file.replace(/\.zip$/,'.json'),{force:true});}}
  else if(args[0]==='--rollback'&&args[1])console.log(JSON.stringify(applyRollback(root,args[1])));
  else if(args[0]==='--list')console.log(JSON.stringify(listSnapshots(path.join(root,'data')),null,2));
  else throw Error('Use npm run update -- --archive /path/release.zip, --list, or --rollback SNAPSHOT_ID');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(ownsLock)fs.rmSync(lock,{force:true});}
