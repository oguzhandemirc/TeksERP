// TOTP sırrının saklama sarmalı: AES-256-GCM, anahtar HKDF ile kısa kimlik halkasından türer.
// PIN özetiyle aynı disiplin — anahtar LICENSE_DIR'de, DB kopyası (düz .dump) tek başına sırrı vermez;
// halkanın emaneti şifreli yedekte olduğu için TOTP anahtarı ayrıca emanet edilmez.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { KeyRing, RingKey } from "./keyring";

export const TOTP_SECRET_ENC_PREFIX = "enc1:";
const HKDF_INFO = "tekserp/totp-sir/v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const STORED_RE = /^enc1:([0-9a-f]{16}):([A-Za-z0-9_-]+)$/;

function aesKey(k: RingKey): Buffer {
  return Buffer.from(hkdfSync("sha256", k.key, "", HKDF_INFO, 32));
}

export function isSealedTotpSecret(stored: string): boolean {
  return stored.startsWith(TOTP_SECRET_ENC_PREFIX);
}

/** Açık base32 sır → `enc1:<kid>:<b64url(iv|tag|ct)>`. Her çağrı yeni IV (eşitlik AÇIK değerle ölçülür). */
export function sealTotpSecret(k: RingKey, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", aesKey(k), iv);
  cipher.setAAD(Buffer.from(k.kid, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${TOTP_SECRET_ENC_PREFIX}${k.kid}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")}`;
}

/** Sarılı değer → açık sır; anahtar halkada yoksa ya da bayt bozuksa `null` (çağıran fail-closed davranır). */
export function openTotpSecret(ring: KeyRing, stored: string): string | null {
  const m = STORED_RE.exec(stored);
  if (!m) return null;
  const k = ring.keys.find((x) => x.kid === m[1]);
  if (!k) return null;
  const buf = Buffer.from(m[2]!, "base64url");
  if (buf.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", aesKey(k), buf.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(k.kid, "utf8"));
    decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
