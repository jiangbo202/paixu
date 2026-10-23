export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
export async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join(''); }
const passwordIterations=100000;
const hex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
function equalHashes(a,b) {
  if(a.length!==b.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
export function validSetupKey(value) {
  return typeof value === 'string' && value.length >= 32 && value.length <= 256 && !/[\s\p{Cc}]/u.test(value);
}
export async function verifySetupKey(value, expected) {
  if (!validSetupKey(expected) || !validSetupKey(value)) return false;
  return equalHashes(await digest(value), await digest(expected));
}
export function validNewPassword(value) {
  return typeof value==='string' && [...value].length>=12 && [...value].length<=128 && value.trim().length>0 && !/[\p{Cc}]/u.test(value);
}
async function derivePassword(value,salt) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:passwordIterations},key,256)));
}
export async function hashPassword(value) {
  if(!validNewPassword(value))throw new HttpError(400,'Use a password of 12–128 characters','invalid_password');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${passwordIterations}$${hex(salt)}$${await derivePassword(value,salt)}`;
}
export async function verifyPassword(value,stored) {
  if(typeof value!=='string'||value.length>256||typeof stored!=='string')return false;
  if(/^[a-f0-9]{64}$/.test(stored))return equalHashes(await digest(value),stored);
  const parts=stored.split('$');
  if(parts.length!==4||parts[0]!=='pbkdf2-sha256'||parts[1]!==String(passwordIterations)||!/^[a-f0-9]{32}$/.test(parts[2])||!/^[a-f0-9]{64}$/.test(parts[3]))return false;
  const salt=Uint8Array.from(parts[2].match(/../g),n=>parseInt(n,16));
  return equalHashes(await derivePassword(value,salt),parts[3]);
}
export function cookie(request, name) { return (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || ''; }
export function sessionCookie(request, name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export class HttpError extends Error { constructor(status, message, code = 'request_error') { super(message); this.status = status; this.code = code; } }
export async function jsonBody(request, max = 8192) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'Expected application/json');
  const bytes = await limitedBody(request, max);
  try { const parsed = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; }
  catch { throw new HttpError(400, 'Invalid JSON'); }
}
export async function limitedBody(request, max) {
  if (Number(request.headers.get('content-length')) > max) throw new HttpError(413, 'Request too large');
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new HttpError(413, 'Request too large'); } chunks.push(value); }
  const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
}
