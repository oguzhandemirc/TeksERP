// Kısa kimlik halkasıyla DB alanı sarmalı — AES-256-GCM, anahtar halka anahtarından HKDF (amaç başına ayrı etiket).
// Tek kaynak: TOTP sırrı (`totp-crypto.ts`) ve patron push belirteci aynı şifreyi kullanır; DB kopyası tek başına açılmaz,
// halkanın emaneti şifreli yedektedir. Biçim `<önek><kid>:<b64url(iv|tag|ct)>`; AAD = kid (+ isteğe bağlı bağlam).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { KeyRing, RingKey } from "./keyring";

export interface SealPurpose {
  /** Saklanan değerin öneki (`enc1:` · `ptk1:`) — biçimi ve amacı aynı anda işaretler. */
  readonly prefix: string;
  /** HKDF `info` etiketi — amaçlar arası anahtar ayrımı. */
  readonly info: string;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

function aesKey(k: RingKey, purpose: SealPurpose): Buffer {
  return Buffer.from(hkdfSync("sha256", k.key, "", purpose.info, 32));
}

function aad(kid: string, context: string | undefined): Buffer {
  return Buffer.from(context === undefined ? kid : `${kid}|${context}`, "utf8");
}

/** Açık değer → sarılı dize. Her çağrı yeni IV. `context` AAD'ye girer: başka satıra taşınan değer açılmaz. */
export function sealWithRing(k: RingKey, plain: string, purpose: SealPurpose, context?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", aesKey(k, purpose), iv);
  cipher.setAAD(aad(k.kid, context));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${purpose.prefix}${k.kid}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")}`;
}

/** Sarılı dize → açık değer; önek/anahtar/bağlam uymuyorsa ya da bayt bozuksa `null` (çağıran fail-closed). */
export function openWithRing(ring: KeyRing, stored: string, purpose: SealPurpose, context?: string): string | null {
  if (!stored.startsWith(purpose.prefix)) return null;
  const m = /^([0-9a-f]{16}):([A-Za-z0-9_-]+)$/.exec(stored.slice(purpose.prefix.length));
  if (!m) return null;
  const k = ring.keys.find((x) => x.kid === m[1]);
  if (!k) return null;
  const buf = Buffer.from(m[2]!, "base64url");
  if (buf.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", aesKey(k, purpose), buf.subarray(0, IV_BYTES));
    decipher.setAAD(aad(k.kid, context));
    decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
