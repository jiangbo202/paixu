import test from 'node:test';
import assert from 'node:assert/strict';
import { coarseRegion, maskIp, browserName, publicNetwork } from '../backend/network.js';
test('public network summaries mask IPv4 and IPv6 and never pass unknown strings through', () => {
  assert.equal(maskIp('192.0.2.123'), '192.0.*.*');
  assert.equal(maskIp('::ffff:192.0.2.123'), '192.0.*.*');
  assert.equal(maskIp('2001:0db8:85a3::8a2e:370:7334'), '2001:db8:*:*:*:*:*:*');
  assert.equal(maskIp('::1'), '0:0:*:*:*:*:*:*');
  for (const bad of ['', 'private-ip', '<script>', '999.0.0.1', '2001::::1', '1:2:3:4:5:6:7:']) assert.equal(maskIp(bad), '');
  const network = publicNetwork({ ip: '192.0.2.123', browser: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 secret-fingerprint', country: 'CN', region: 'Guangdong' });
  assert.equal(network.browser, 'Chrome 140'); assert.doesNotMatch(JSON.stringify(network), /123|secret-fingerprint|Mozilla/);
});
test('browser detection orders branded browsers before Chrome/Safari and handles iOS', () => {
  assert.equal(browserName('Chrome/140 Safari/537 Edg/140.0'), 'Edge 140');
  assert.equal(browserName('CriOS/130.0 Mobile Safari/604.1'), 'Chrome 130');
  assert.equal(browserName('Version/18.0 Mobile Safari/604.1'), 'Safari 18');
  assert.equal(browserName('FxiOS/131.0 Mobile Safari/604'), 'Firefox 131');
  assert.equal(browserName('<img onerror=alert(1)>'), 'Other');
});
test('only coarse region properties are retained, unavailable local geo stays unknown', () => {
  assert.deepEqual(coarseRegion({ country: 'CN', region: 'Guangdong', city: 'Shenzhen', latitude: '22.5', longitude: '114' }), { country: 'CN', region: 'Guangdong' });
  assert.deepEqual(coarseRegion(), { country: '', region: '' });
  assert.deepEqual(coarseRegion({ country: 'XX', region: 'Unknown' }), { country: '', region: '' });
});
