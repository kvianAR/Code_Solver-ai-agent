import crypto from 'node:crypto';
import fs from 'node:fs';

export const newPairingKey = () => crypto.randomBytes(32).toString('hex');
export function allowPairing(req, key) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const host = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host || '');
  const origin = req.headers.origin;
  const extension = !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  const provided = Buffer.from(String(req.headers['x-practice-pairing'] || ''));
  const expected = Buffer.from(key || '');
  return local && host && extension && expected.length === 64 && provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
export function writePairingFile(file, url, key) {
  fs.writeFileSync(file + '.tmp', JSON.stringify({url, pairingKey: key}), {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
}
