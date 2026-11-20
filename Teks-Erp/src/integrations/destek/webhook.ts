import { DestekWebhookError } from './errors';
import { sha256Hex, SIGNATURE_TOLERANCE_SECONDS, signaturesEqual, hmacHex, webhookStringToSign } from './signature';
import type { DestekWebhookEvent } from './types';

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const bag = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(bag).find((k) => k.toLowerCase() === name);
  const v = key ? bag[key] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Merkezden gelen webhook'u doğrular ve olayı döner.
 *
 * - `rawBody`: isteğin HAM gövdesi (JSON'a çevrilmeden önceki bayt/metin; Express'te `express.raw({ type: 'application/json' })`).
 * - İmza: hex(HMAC-SHA256(webhookSecret, `${X-Destek-Timestamp}.${sha256hex(rawBody)}`)), zamanlama sızdırmadan karşılaştırılır.
 * - Zaman damgası ±5 dk (`toleranceSeconds`) dışındaysa reddedilir (yeniden oynatmaya karşı); aynı `eventId`'yi
 *   ikinci kez işlememek ürünün işidir (tekrar denemelerde aynı olay yeniden gelebilir).
 *
 * @throws DestekWebhookError `INVALID_SIGNATURE` | `TIMESTAMP_OUT_OF_RANGE` | `INVALID_PAYLOAD`
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: HeaderBag,
  secret: string,
  options: { toleranceSeconds?: number; nowMs?: number } = {},
): DestekWebhookEvent {
  const ts = header(headers, 'x-destek-timestamp');
  const signature = header(headers, 'x-destek-signature');
  if (!ts || !/^\d{1,12}$/.test(ts) || !signature) throw new DestekWebhookError('INVALID_SIGNATURE', 'İmza başlıkları eksik.');
  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - Number(ts)) > (options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) {
    throw new DestekWebhookError('TIMESTAMP_OUT_OF_RANGE', 'Webhook zaman damgası pencere dışında.');
  }
  const expected = hmacHex(secret, webhookStringToSign(ts, sha256Hex(rawBody)));
  if (!signaturesEqual(expected, signature)) throw new DestekWebhookError('INVALID_SIGNATURE', 'Webhook imzası geçersiz.');
  try {
    const event = JSON.parse(typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8')) as DestekWebhookEvent;
    if (!event || typeof event.eventId !== 'string' || typeof event.type !== 'string') throw new Error('eksik alan');
    return event;
  } catch {
    throw new DestekWebhookError('INVALID_PAYLOAD', 'Webhook gövdesi okunamadı.');
  }
}
