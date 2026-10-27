import fs from 'node:fs';
const file=process.env.DATA_DIR?process.env.DATA_DIR+'/state.json':new URL('../data/state.json',import.meta.url);
if(!fs.existsSync(file)){console.error('Start the server once to create its connection token.');process.exit(1);}
console.log(JSON.parse(fs.readFileSync(file)).adminToken);
