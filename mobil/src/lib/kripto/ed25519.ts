// Ed25519 imza DOĞRULAMASI — denetlenmiş `@noble/curves` (saf JS, native modül yok → OTA ile gider; kullanıcı onayı
// 2026-10-01). Hermes'te node:crypto yok. KATI kip: noble'ın RFC 8032 / FIPS 186-5 kipi (`zip215: false` — kanonik
// A/R kodlaması, S < L, küçük mertebeli A RED) + bizim eklediğimiz küçük mertebeli R reddi (libsodium kuralı).
// Kâhin: `kripto.test.ts` (RFC 8032 · Wycheproof EdDSA 151 vektör · node:crypto rastgele/bozulma · katı kurallar).
import { ed25519 } from '@noble/curves/ed25519.js';

const SIKI = { zip215: false } as const;

/** Kodlama → nokta (kanonik + çözülebilir); geçersizse null. */
function decodePoint(b: Uint8Array): InstanceType<typeof ed25519.Point> | null {
  try {
    return ed25519.Point.fromBytes(b, false);
  } catch {
    return null;
  }
}

/** Yalnız bekçi: kodlama → geçerli nokta mı (kanonik + çözülebilir) ve küçük mertebeli mi — katı kuralların birim ölçümü. */
export const _testing = {
  isValidEncoding: (b: Uint8Array): boolean => decodePoint(b) !== null,
  isSmallOrder: (b: Uint8Array): boolean => decodePoint(b)?.isSmallOrder() ?? false,
};

/** İmza doğru mu? Biçimsiz anahtar/imza da `false` (atmaz). */
export function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const r = decodePoint(signature.subarray(0, 32));
  if (!r || r.isSmallOrder()) return false;
  try {
    return ed25519.verify(signature, message, publicKey, SIKI);
  } catch {
    return false;
  }
}
