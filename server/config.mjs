import fs from 'node:fs';
export const DEFAULT = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
export function validateConfig(input) {
  const c = structuredClone(input);
  new Intl.DateTimeFormat('en', { timeZone: c.timezone });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.dailyStartTime)) throw Error('Time must be HH:MM');
  for (const [key, min, max] of [['dailyQuestionCount',1,10],['planLengthDays',1,28],['maxAttempts',1,8],['retryBaseSeconds',1,60],['maxRetrySeconds',1,600],['dailyTokenBudget',1000,1000000],['maxOutputTokens',128,16384],['requestTimeoutSeconds',5,180],['autoContestDurationMinutes',5,360],['autoContestQuestionCount',1,10]]) {
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw Error(`Invalid ${key}`);
  }
  if (!['python','javascript'].includes(c.language)) throw Error('Language must be python or javascript');
  if (!Array.isArray(c.allowedDifficulties) || !c.allowedDifficulties.length || c.allowedDifficulties.some(x=>!['Easy','Medium','Hard'].includes(x))) throw Error('Choose at least one difficulty');
  if (!Array.isArray(c.providerOrder) || !c.providerOrder.length || new Set(c.providerOrder).size !== c.providerOrder.length || c.providerOrder.some(x=>!['groq','gemini'].includes(x))) throw Error('Invalid providers');
  for (const p of ['groq','gemini']) if (typeof c.models?.[p] !== 'string' || !/^[a-zA-Z0-9._\/-]{1,120}$/.test(c.models[p])) throw Error(`Invalid ${p} model`);
  if (!['sandbox','http'].includes(c.platform?.type)) throw Error('Unknown platform');
  if (c.platform.type === 'http' && !/^https?:\/\//.test(c.platform.baseUrl)) throw Error('Platform URL required');
  if (c.notificationWebhook && !c.notificationWebhook.startsWith('https://')) throw Error('Webhook must use HTTPS');
  if (c.planRefreshDay !== 'Monday') throw Error('Plan refresh day must be Monday');
  if (![c.autoMode,c.contestMode,c.preferQuestionOfTheDay,c.autoWeeklyContest].every(x=>typeof x==='boolean')) throw Error('Invalid switches');
  if(c.leetcode&&typeof c.leetcode.enforceUsername!=='boolean')c.leetcode.enforceUsername=false;
  if (typeof c.leetcode?.enabled!=='boolean'||typeof c.leetcode?.username!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(c.leetcode.username)||typeof c.leetcode.enforceUsername!=='boolean') throw Error('Invalid LeetCode browser settings');
  if (!['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].includes(c.autoContestDay)) throw Error('Invalid auto contest day');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.autoContestTime)) throw Error('Auto contest time must be HH:MM');
  if (!Number.isInteger(c.judge?.timeoutSeconds) || c.judge.timeoutSeconds < 1 || c.judge.timeoutSeconds > 30 || !Number.isInteger(c.judge.memoryMB) || c.judge.memoryMB<64 || c.judge.memoryMB>512 || typeof c.judge.cpus!=='number' || c.judge.cpus<0.1 || c.judge.cpus>2) throw Error('Invalid judge limits');
  return c;
}
