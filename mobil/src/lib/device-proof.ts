// Cihaz kanıtı — backend `Teks-Erp/src/lib/device-proof.ts`in istemci ikizi (biçim BAYT-EŞİT):
// `x-device-proof: v1.<ms>.<HMAC-SHA256(sır, "v1\n<ms>\n<YÖNTEM>\n<yol>")>`; sır sunucunun
// announce/status cevabında BİR KEZ verdiği 64 hex. Tablette WebCrypto yok → saf HMAC.
import { sha256Bytes, utf8Bytes } from './qr-parca';

const BLOCK = 64;

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hmacSha256Hex(keyBytes: readonly number[], message: string): string {
  let key = [...keyBytes];
  if (key.length > BLOCK) key = sha256Bytes(key);
  while (key.length < BLOCK) key.push(0);
  const inner = sha256Bytes([...key.map((b) => b ^ 0x36), ...utf8Bytes(message)]);
  return toHex(sha256Bytes([...key.map((b) => b ^ 0x5c), ...inner]));
}

export const DEVICE_SECRET_RE = /^[0-9a-f]{64}$/;

/** İmzalanan yol: şema+sunucu, sorgu ve parça atılır (sunucu `originalUrl`in yol kısmını imzalar). */
export function proofPathOf(uri: string): string {
  const noOrigin = uri.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const path = noOrigin.split('?')[0]!.split('#')[0]!;
  return path.startsWith('/') ? path : `/${path}`;
}

export function buildDeviceProof(secretHex: string, ts: number, method: string, path: string): string {
  const msg = `v1\n${ts}\n${method.toUpperCase()}\n${path}`;
  return `v1.${ts}.${hmacSha256Hex(hexToBytes(secretHex), msg)}`;
}
