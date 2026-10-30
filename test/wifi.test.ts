import test from 'node:test';
import assert from 'node:assert/strict';
import { wifiPayload, wifiQrSvg } from '../server/wifi.ts';

test('guest Wi-Fi QR payload escapes reserved characters and can render as SVG', async () => {
  const wifi = { ssid: 'Guest;WiFi', password: 'pass:word"123', security: 'WPA' as const, hidden: true };
  assert.equal(wifiPayload(wifi), 'WIFI:T:WPA;S:Guest\\;WiFi;P:pass\\:word\\"123;H:true;;');
  const svg = await wifiQrSvg(wifi);
  assert.match(svg, /<svg/);
  assert.equal(svg.includes(wifi.password), false);
});

test('open guest Wi-Fi QR does not include a password field', () => {
  assert.equal(wifiPayload({ ssid: 'Guest', password: '', security: 'nopass', hidden: false }), 'WIFI:T:nopass;S:Guest;H:false;;');
});
