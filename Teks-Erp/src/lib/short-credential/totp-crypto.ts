// TOTP sırrının saklama sarmalı: AES-256-GCM, anahtar HKDF ile kısa kimlik halkasından türer (`ring-seal.ts`).
// PIN özetiyle aynı disiplin — anahtar LICENSE_DIR'de, DB kopyası (düz .dump) tek başına sırrı vermez;
// halkanın emaneti şifreli yedekte olduğu için TOTP anahtarı ayrıca emanet edilmez.
import type { KeyRing, RingKey } from "./keyring";
import { openWithRing, sealWithRing, type SealPurpose } from "./ring-seal";

export const TOTP_SECRET_ENC_PREFIX = "enc1:";
const TOTP_PURPOSE: SealPurpose = { prefix: TOTP_SECRET_ENC_PREFIX, info: "tekserp/totp-sir/v1" };

export function isSealedTotpSecret(stored: string): boolean {
  return stored.startsWith(TOTP_SECRET_ENC_PREFIX);
}

/** Açık base32 sır → `enc1:<kid>:<b64url(iv|tag|ct)>`. Her çağrı yeni IV (eşitlik AÇIK değerle ölçülür). */
export function sealTotpSecret(k: RingKey, plain: string): string {
  return sealWithRing(k, plain, TOTP_PURPOSE);
}

/** Sarılı değer → açık sır; anahtar halkada yoksa ya da bayt bozuksa `null` (çağıran fail-closed davranır). */
export function openTotpSecret(ring: KeyRing, stored: string): string | null {
  return openWithRing(ring, stored, TOTP_PURPOSE);
}
