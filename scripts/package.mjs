import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const destination=path.join(root,'releases');fs.mkdirSync(destination,{recursive:true});
const archive=path.join(destination,`practice-ex-${version}.zip`);
fs.rmSync(archive,{force:true});
execFileSync('zip',['-qr',archive,'extension','server','scripts','test','docs','Start Practice Ex.command','package.json','config.json','compatibility.json','README.md','CHANGELOG.md','LICENSE','CONTRIBUTING.md','Dockerfile','compose.yaml','.gitignore','.dockerignore','-x','extension/local-connection.json*','*.log','*.DS_Store'],{cwd:root});
const files=execFileSync('unzip',['-Z1',archive],{encoding:'utf8'}).split('\n');
if(files.some(file=>/local-connection\.json|(^|\/)data\/|vault\.key|(^|\/)\.env($|\.)/.test(file))){fs.rmSync(archive);throw Error('Release archive contained private runtime data');}
console.log(`Created ${archive}. Local pairing information and runtime data are excluded.`);
