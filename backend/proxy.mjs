import { isIP } from 'node:net';

function address(value) {
  if(typeof value!=='string' || !isIP(value)) return null;
  return value.toLowerCase().replace(/^::ffff:(?=\d+\.)/,'');
}
export function trustedProxies(value='') {
  return new Set(value.split(',').map(ip=>ip.trim()).filter(Boolean).map(ip=>{
    const normalized=address(ip);
    if(!normalized)throw new Error('TRUST_PROXY_IPS must contain only explicit IP addresses');
    return normalized;
  }));
}
export function clientAddress(remote, forwarded, trusted=new Set()) {
  const peer=address(remote)||'unknown';
  if(!trusted.has(peer) || typeof forwarded!=='string')return peer;
  const hops=forwarded.split(',').map(ip=>address(ip.trim()));
  // A malformed chain falls back to the socket peer, never a client-controlled value.
  if(hops.some(ip=>!ip))return peer;
  let current=peer;
  for(const hop of hops.reverse()) {
    if(!trusted.has(current))break;
    current=hop;
  }
  return current;
}
