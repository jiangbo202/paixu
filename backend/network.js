// Store only coarse provider geolocation; never trust user-supplied location headers.
export function coarseRegion(cf) {
  const country = /^[A-Z]{2}$/.test(cf?.country) && !['XX', 'T1'].includes(cf.country) ? cf.country : '';
  const region = country && typeof cf?.region === 'string' ? cf.region.replace(/[\p{Cc}\p{Cf}<>]/gu, '').slice(0, 80) : '';
  return { country, region };
}
export function maskIp(value) {
  const ip = String(value || '').replace(/^::ffff:/i, '');
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => Number(n) <= 255)) return ip.split('.').slice(0, 2).join('.') + '.*.*';
  if (/^[a-f0-9:]+$/i.test(ip) && ip.includes(':') && ip.length <= 39) {
    const parts = ip.split('::'); if (parts.length > 2) return '';
    const left = parts[0] ? parts[0].split(':') : [], right = parts[1] ? parts[1].split(':') : [];
    if ([...left, ...right].some(p => !p || p.length > 4) || (parts.length === 1 ? left.length !== 8 : left.length + right.length >= 8)) return '';
    const expanded = parts.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    return expanded.slice(0, 2).map(p => parseInt(p, 16).toString(16)).join(':') + ':*:*:*:*:*:*';
  }
  return '';
}
export function browserName(ua = '') {
  for (const [pattern, name] of [[/(?:Edg|EdgA|EdgiOS)\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'], [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'], [/Version\/(\d+).*Safari\//, 'Safari']]) {
    const match = ua.match(pattern); if (match) return `${name} ${match[1]}`;
  }
  return 'Other';
}
export function publicNetwork(row) { return { ip: maskIp(row.ip), browser: row.browser ? browserName(row.browser) : '', country: row.country || '', region: row.region || '' }; }
