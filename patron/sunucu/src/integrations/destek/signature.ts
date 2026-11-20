import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * İmza kanonik biçimi. Merkezdeki `api/src/modules/integration/signature.ts` ile birebir aynıdır;
 * biçim yalnız ikisi birlikte değişir (bkz. `docs/ENTEGRASYON.md`).
 *
 * İstek:   hex(HMAC-SHA256(apiKey, `${ts}.${nonce}.${METHOD}.${yol+sorgu}.${gövdeÖzeti}`))
 * Webhook: hex(HMAC-SHA256(webhookSecret, `${ts}.${sha256hex(ham gövde)}`))
 */

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Kanonik JSON: anahtarlar sıralı (JS `sort`), boşluksuz; diziler sırasını korur. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Multipart gövde özeti: canonicalJson(metin alanları) + "\n" + her dosyanın sha256hex'i (gönderim sırasıyla). */
export function multipartBodyHash(fields: Record<string, string>, fileSha256Hexes: string[]): string {
  return sha256Hex([canonicalJson(fields), ...fileSha256Hexes].join('\n'));
}

export function requestStringToSign(timestamp: string, nonce: string, method: string, pathWithQuery: string, bodyHash: string): string {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${pathWithQuery}.${bodyHash}`;
}

/** Nonce biçimi: 16–64 karakter `[A-Za-z0-9_-]` (önerilen: 16 rastgele baytın hex'i ya da UUID'siz 32 hex). */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function webhookStringToSign(timestamp: string, bodyHash: string): string {
  return `${timestamp}.${bodyHash}`;
}

export function hmacHex(key: string, text: string): string {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex');
}

export function signaturesEqual(expectedHex: string, givenHex: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(givenHex) || !/^[0-9a-f]{64}$/.test(expectedHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(givenHex, 'hex'));
}

/** İstek imza başlıkları. */
export function signRequest(
  apiKey: string,
  input: { method: string; pathWithQuery: string; bodyHash: string; timestampSec?: number; nonce?: string },
): { 'X-Destek-Timestamp': string; 'X-Destek-Nonce': string; 'X-Destek-Signature': string } {
  const ts = String(input.timestampSec ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  return {
    'X-Destek-Timestamp': ts,
    'X-Destek-Nonce': nonce,
    'X-Destek-Signature': hmacHex(apiKey, requestStringToSign(ts, nonce, input.method, input.pathWithQuery, input.bodyHash)),
  };
}
