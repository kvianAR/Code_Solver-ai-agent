import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT, validateConfig } from './config.mjs';
export class Store {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const keyPath=path.join(dir,'vault.key');
    if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath,crypto.randomBytes(32),{mode:0o600});
    this.key=fs.readFileSync(keyPath);
    this.file=path.join(dir,'state.json');
    this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file)): {config:structuredClone(DEFAULT),secrets:{},jobs:[],notifications:[],contests:[],plan:null,usage:{},disabledProviders:{},adminToken:process.env.ADMIN_TOKEN||crypto.randomBytes(32).toString('hex')};
    const sourceHash=crypto.createHash('sha256').update(JSON.stringify(DEFAULT)).digest('hex');
    // Updates may add defaults, but must preserve saved times and models.
    this.state.config={...structuredClone(DEFAULT),...this.state.config,
      models:{...DEFAULT.models,...this.state.config?.models},
      leetcode:{...DEFAULT.leetcode,...this.state.config?.leetcode}};
    this.state.configSourceHash=sourceHash;
    if (process.env.ADMIN_TOKEN) this.state.adminToken=process.env.ADMIN_TOKEN;
    validateConfig(this.state.config);
    this.save();
  }
  save() { fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.state,null,2),{mode:0o600}); fs.renameSync(this.file+'.tmp',this.file); }
  encrypt(value) { const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',this.key,iv); return Buffer.concat([iv,c.update(value),c.final(),c.getAuthTag()]).toString('base64'); }
  decrypt(value) { const b=Buffer.from(value,'base64'),d=crypto.createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12)); d.setAuthTag(b.subarray(-16)); return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString(); }
  secret(name) { if (this.state.secrets[name]) return this.decrypt(this.state.secrets[name]); return process.env[`${name.toUpperCase()}_API_KEY`] || ''; }
  setSecret(name,value) { if (value) this.state.secrets[name]=this.encrypt(value); else delete this.state.secrets[name]; delete this.state.disabledProviders[name]; this.save(); }
  publicState() {
    const {config,jobs,notifications,contests,plan,usage,disabledProviders}=this.state;
    return {config,jobs,notifications,contests,plan,usage,disabledProviders,providers:Object.fromEntries(['groq','gemini'].map(p=>[p,{configured:!!this.secret(p),model:config.models[p]}]))};
  }
}
