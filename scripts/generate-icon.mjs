import fs from 'node:fs';
import {deflateSync} from 'node:zlib';
const crc=b=>{let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const t=Buffer.from(type),n=Buffer.alloc(4),sum=Buffer.alloc(4);n.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,sum]);};
const size=128,raw=Buffer.alloc((size*3+1)*size),letter=['01110','11000','11000','01110','00011','00011','11110'];
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const gx=Math.floor((x-34)/12),gy=Math.floor((y-22)/12),white=gx>=0&&gx<5&&gy>=0&&gy<7&&letter[gy][gx]==='1',i=y*(size*3+1)+1+x*3;raw.set(white?[255,255,255]:[36,131,109],i);}
const head=Buffer.alloc(13);head.writeUInt32BE(size);head.writeUInt32BE(size,4);head[8]=8;head[9]=2;
fs.writeFileSync(new URL('../extension/icon.png',import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
