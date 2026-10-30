import QRCode from 'qrcode';
import type { Config } from './config.ts';

type GuestWifi = NonNullable<Config['guestWifi']>;
const escapeWifi = (value: string) => value.replace(/[\\;,:\"]/g, '\\$&');

export function wifiPayload(wifi: GuestWifi) {
  const password = wifi.security === 'nopass' ? '' : `P:${escapeWifi(wifi.password)};`;
  return `WIFI:T:${wifi.security};S:${escapeWifi(wifi.ssid)};${password}H:${wifi.hidden};;`;
}

export function wifiQrSvg(wifi: GuestWifi) {
  return QRCode.toString(wifiPayload(wifi), { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#111111', light: '#ffffff' } });
}
