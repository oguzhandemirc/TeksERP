// Kısa kimlik özetleri: "<kid>:<HMAC-SHA256 hex>". Deterministik (PIN @unique kalır), geri
// çevrilemez; alan ayrımı ("pin:" / "card:<userId>:") bir özetin öbür alanda geçmesini önler.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RingKey } from "./keyring";

/** Personel kartı QR içeriği. Yeni basım 256 bit (64 hex); eski 128 bit (32 hex) kartlar geçerli kalır. */
export const CARD_CODE_RE = /^TEKSU:([0-9a-fA-F-]{36}):([0-9a-fA-F]{32}|[0-9a-fA-F]{64})$/;
export const CARD_SECRET_BYTES = 32;
export const LEGACY_CARD_SECRET_HEX = 32;

const DIGEST_RE = /^([0-9a-f]{16}):([0-9a-f]{64})$/;

function hmacHex(key: Buffer, input: string): string {
  return createHmac("sha256", key).update(input, "utf8").digest("hex");
}

export function digestQuickPin(k: RingKey, pin: string): string {
  return `${k.kid}:${hmacHex(k.key, `pin:${pin}`)}`;
}

export function digestCardSecret(k: RingKey, userId: string, secret: string): string {
  return `${k.kid}:${hmacHex(k.key, `card:${userId.toLowerCase()}:${secret.toLowerCase()}`)}`;
}

export function digestKid(stored: string | null | undefined): string | null {
  const m = stored ? DIGEST_RE.exec(stored) : null;
  return m ? m[1]! : null;
}

/** Sabit zamanlı karşılaştırma — uzunluk farkı da sızdırılmaz. */
export function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Kart kodunu ayrıştırır — kullanıcı kimliği SIR DEĞİLDİR (kilit kovası için), sır küçük harfe iner. */
export function parseCardCode(cardCode: string): { userId: string; secret: string } | null {
  const m = CARD_CODE_RE.exec((cardCode ?? "").trim());
  return m ? { userId: m[1]!.toLowerCase(), secret: m[2]!.toLowerCase() } : null;
}

/**
 * Satırdaki GEÇERLİ özet. Bu sürüm özet yazarken düz kolonu hep boşaltır; ikisi birden doluysa
 * düzü özetten SONRA geri alınmış eski backend yazmıştır ⇒ düz esastır, özet bayattır.
 */
export function liveDigest(plain: string | null | undefined, digest: string | null | undefined): string | null {
  return plain != null ? null : (digest ?? null);
}
