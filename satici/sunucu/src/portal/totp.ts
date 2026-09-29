// TOTP (RFC 6238: HMAC-SHA1, 6 hane, 30 sn) — node:crypto, yeni paket yok. Backend'deki
// `Teks-Erp/src/services/totp.service.ts` ile aynı algoritma (authenticator uygulamaları SHA1 bekler).
// Tekrar oynatma kilidi: kabul edilen adım saklanır, `adım <= son adım` REDDEDİLİR (RFC 6238 §5.2).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** ±1 adım (±30 sn) — telefon saati NTP ile senkron; genişletmek kaba kuvvete pay verir. */
export const TOTP_DRIFT_STEPS = 1;
export const TOTP_ISSUER = "TeksERP Satici";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Geçersiz base32 karakteri");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 bayt (160 bit) rastgele sır, base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buf).digest();
  key.fill(0);
  const offset = digest[digest.length - 1]! & 0x0f;
  const bin =
    ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpStep(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

export type TotpCheck = { readonly ok: true; readonly step: number } | { readonly ok: false; readonly reason: "BICIM" | "UYUSMADI" | "TEKRAR" };

/** Kodu doğrular; eşleşen EN YENİ adımı döndürür. `lastUsedStep` ve öncesi tekrar sayılır. */
export function verifyTotp(secretBase32: string, code: string, g: { atMs: number; lastUsedStep: number | null }): TotpCheck {
  const candidate = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate)) return { ok: false, reason: "BICIM" };
  const current = totpStep(g.atMs);
  let replay = false;
  for (let offset = -TOTP_DRIFT_STEPS; offset <= TOTP_DRIFT_STEPS; offset++) {
    const step = current - offset;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secretBase32, step));
    const given = Buffer.from(candidate);
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      if (g.lastUsedStep !== null && step <= g.lastUsedStep) {
        replay = true;
        continue;
      }
      return { ok: true, step };
    }
  }
  return { ok: false, reason: replay ? "TEKRAR" : "UYUSMADI" };
}

export function otpauthUri(accountName: string, secretBase32: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${accountName}`);
  const issuer = encodeURIComponent(TOTP_ISSUER);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
