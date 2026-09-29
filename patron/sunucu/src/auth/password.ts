// Bulut hesap parolası — scrypt (node:crypto; yeni paket yok). Saklanan biçim:
//   scrypt$<log2 N>$<r>$<p>$<tuz b64u>$<özet b64u>
// Karşılaştırma sabit zamanlı; bilinmeyen kullanıcıda da aynı maliyette bir doğrulama koşulur
// (yanıt süresi hesabın varlığını sızdırmasın).
import crypto from "node:crypto";
import { promisify } from "node:util";
import { CloudError } from "../lib/errors";

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

export const MIN_PASSWORD_LENGTH = 12;
const LOG2_N = 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAXMEM = 128 * 1024 * 1024;
const FORMAT = /^scrypt\$(\d{2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

export function assertPasswordStrength(password: string): void {
  const length = [...password.normalize("NFC")].length;
  if (length < MIN_PASSWORD_LENGTH || length > 200) {
    throw new CloudError(400, "PAROLA_ZAYIF", `Parola ${MIN_PASSWORD_LENGTH}–200 karakter olmalı`);
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordStrength(password);
  const salt = crypto.randomBytes(16);
  const digest = await scryptAsync(Buffer.from(password.normalize("NFC"), "utf8"), salt, KEY_LENGTH, { N: 1 << LOG2_N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${LOG2_N}$${R}$${P}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

/** Doğrular; biçimsiz saklı değer `false` döner (fırlatmaz). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = FORMAT.exec(stored);
  if (!m) return false;
  const log2n = Number(m[1]);
  if (log2n < 14 || log2n > 17) return false;
  const expected = Buffer.from(m[5]!, "base64url");
  const actual = await scryptAsync(Buffer.from(password.normalize("NFC"), "utf8"), Buffer.from(m[4]!, "base64url"), expected.length, {
    N: 1 << log2n,
    r: Number(m[2]),
    p: Number(m[3]),
    maxmem: MAXMEM,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Bilinmeyen/uygun olmayan kullanıcıda harcanan eşdeğer iş (sonuç atılır). */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("bos-kullanici-parolasi-degil");
  await verifyPassword(password, await dummyHash);
}
