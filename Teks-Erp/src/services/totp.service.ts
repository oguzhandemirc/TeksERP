// =============================================================================
// TeksERP — TOTP (RFC 6238) · SAF FONKSİYONLAR
// =============================================================================
// Uzaktan erişimin ikinci faktörü. Bu dosya DB'ye dokunmaz ve Express bilmez —
// yalnız kriptografi + kodlama. Böylece bekçi RFC 6238'in resmî test
// vektörlerini doğrudan koşturabilir (`scripts/test_totp.ts`).
//
// ⚠️ YENİ NPM PAKETİ YOK. `otplib`/`speakeasy` izinli listede değil ve gereği de
// yok: RFC 6238 pratikte "HMAC-SHA1 + dinamik kırpma"dır ve ikisi de `node:crypto`
// içinde. Kimlik doğrulamanın çekirdeğine bakım yükü belirsiz bir bağımlılık
// eklememek bilinçli bir karardır.
//
// ⚠️ ALGORİTMA SHA1 ve bu DOĞRUDUR. Google Authenticator / Microsoft
// Authenticator / 1Password'ün tamamı SHA1+6 hane+30 sn varsayar; SHA256'ya
// geçmek "daha güvenli" değil, yalnız UYUMSUZ olurdu (HMAC'in güvenliği
// SHA1'in çakışma direncine dayanmaz).
// =============================================================================

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/** Adım süresi (saniye) — RFC 6238 varsayılanı, authenticator uygulamaları sabit kabul eder. */
export const TOTP_STEP_SEC = 30;
/** Kod uzunluğu. */
export const TOTP_DIGITS = 6;
/**
 * Kabul edilen adım kayması. ±1 = ±30 sn.
 *
 * Neden 1 ve neden 2 değil: her ek adım, kodun geçerli olduğu pencereyi
 * genişletir (kaba kuvvet için deneme başına şans artar). Telefon saatleri NTP
 * ile senkron; 30 sn tolerans saha için fazlasıyla yeterli ölçüldü.
 */
export const TOTP_DRIFT_STEPS = 1;

// -----------------------------------------------------------------------------
// Base32 (RFC 4648) — authenticator uygulamalarının beklediği sır kodlaması
// -----------------------------------------------------------------------------

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  // Dolgu ("=") BİLEREK YOK: otpauth:// URI'sinde dolgu karakteri sorun çıkarır
  // ve RFC 4648 dolguyu zorunlu kılmaz. Çözücü de dolguyu yok sayar.
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Geçersiz base32 karakteri: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Yeni TOTP sırrı üret (20 bayt = 160 bit, RFC 4226 §4 önerisi).
 * Base32 metin döner — QR'a ve elle girişe uygun tek biçim budur.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

// -----------------------------------------------------------------------------
// HOTP / TOTP çekirdeği
// -----------------------------------------------------------------------------

/** RFC 4226 HOTP — sayaç bazlı tek kullanımlık kod. */
export function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // 64-bit big-endian sayaç. `writeBigUInt64BE` ile yazılır çünkü JS'in 32-bit
  // bit operatörleri 2^31'i aşan sayaçlarda sessizce taşar (2038 sonrası).
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buf).digest();
  // Dinamik kırpma (RFC 4226 §5.4): son baytın alt 4 biti ofseti verir.
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Verilen ana ait adım numarası. */
export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SEC);
}

/** Adım numarasının kodu. */
export function totpCodeForStep(secretBase32: string, step: number): string {
  return hotp(secretBase32, step);
}

export type TotpVerifyResult =
  | { ok: true; step: number }
  | { ok: false; reason: "format" | "mismatch" | "replay" };

/**
 * Kodu doğrula.
 *
 * @param lastUsedStep Bu kullanıcının EN SON kabul edilen adımı (replay kilidi).
 *
 * ⚠️ REPLAY KORUMASI ŞART. TOTP kodu 30 sn boyunca geçerlidir; omuz sörfü ya da
 * araya giren biri aynı kodu ikinci kez kullanabilirdi. Kabul edilen her adım
 * saklanır ve `step <= lastUsedStep` olan her kod REDDEDİLİR — RFC 6238 §5.2'nin
 * açıkça istediği davranış budur.
 *
 * ⚠️ Karşılaştırma `timingSafeEqual` ile: düz `===` kodun kaçıncı hanede
 * ayrıldığını süreyle sızdırır.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { atMs?: number; lastUsedStep?: number | null; drift?: number } = {},
): TotpVerifyResult {
  const candidate = (code ?? "").replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(candidate)) return { ok: false, reason: "format" };

  const drift = opts.drift ?? TOTP_DRIFT_STEPS;
  const current = totpStep(opts.atMs ?? Date.now());
  const lastUsed = opts.lastUsedStep ?? null;

  // Sıra ESKİDEN YENİYE: birden çok adım eşleşirse (imkânsıza yakın) en eskisini
  // seçmek replay penceresini daraltmaz; en YENİsini seçmek daraltır.
  for (let offset = drift; offset >= -drift; offset--) {
    const step = current - offset;
    if (step < 0) continue;
    const expected = Buffer.from(totpCodeForStep(secretBase32, step));
    const given = Buffer.from(candidate);
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      if (lastUsed !== null && step <= lastUsed) return { ok: false, reason: "replay" };
      return { ok: true, step };
    }
  }
  return { ok: false, reason: "mismatch" };
}

// -----------------------------------------------------------------------------
// Kurulum yardımcıları
// -----------------------------------------------------------------------------

/**
 * `otpauth://` URI'si — authenticator uygulamasının okuduğu QR içeriği.
 *
 * ⚠️ Etiket ve issuer AYRI AYRI kaçırılır. Kullanıcı adında ":" ya da "&" varsa
 * kaçırılmadığında URI parçalanır ve telefon "geçersiz QR" der; teşhisi zor,
 * kullanıcıya sebebi görünmeyen bir arıza.
 */
export function buildOtpauthUri(params: {
  username: string;
  secretBase32: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.username}`);
  const q = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Kurtarma kodu sayısı — telefon kaybında hesabın tek çıkışı. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Kurtarma kodları üret. Biçim `XXXX-XXXX` (Crockford benzeri, karışan
 * karakterler ÇIKARILMIŞ: I/L/O/U yok — kâğıda yazılıp elle giriliyor).
 */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = "";
    // randomBytes başına tek karakter: modulo yanlılığını önlemek için
    // alfabe uzunluğuna bölünen bir aralığa kırpmak yerine reddetme örneklemesi.
    while (s.length < 8) {
      const b = randomBytes(1)[0];
      if (b >= 256 - (256 % RECOVERY_ALPHABET.length)) continue;
      s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    }
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return codes;
}

/** Kullanıcının yazdığı kurtarma kodunu kanonik biçime çeker (tire/boşluk/küçük harf toleransı). */
export function normalizeRecoveryCode(input: string): string {
  const clean = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
