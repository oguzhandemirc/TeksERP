// Satıcı anahtar dosyaları.
//   KÖK / hazırlık kökü / BAYİ: özel yarı scrypt(parola) → AES-256-GCM ile SARILI (parolasız okunamaz);
//     ek veri (AAD) tür + kid + açık yarı + sınıfları bağlar — alanlar kopartılıp başka dosyaya takılamaz.
//   ALT (kira) / İNDİRME: otomatik imza için parolasız, 0600; kök imzalı sertifika dosyanın içinde.
// Parola Buffer olarak dolaşır ve iş bitince sıfırlanır; string'e çevrilmez (V8 string'i silinemez).
import crypto, { type KeyObject } from "node:crypto";
import { promisify } from "node:util";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { LICENSE_CLASSES, KID_PATTERN, publicKeyX, type LicenseClass } from "../lisans-protokol";

export const WRAPPED_KEY_TYPES = ["tekserp-kok-anahtar", "tekserp-bayi-anahtar"] as const;
export type WrappedKeyType = (typeof WRAPPED_KEY_TYPES)[number];
export const SUB_KEY_TYPES = ["tekserp-alt-anahtar", "tekserp-indirme-anahtar"] as const;
export type SubKeyType = (typeof SUB_KEY_TYPES)[number];

/** Kök parolasının alt sınırı — tek başına bütün lisansları imzalar. */
export const MIN_ROOT_PASSWORD_LENGTH = 12;
const SCRYPT_DEFAULT = { N: 1 << 16, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const RAW_KEY_LENGTH = 32;
/** Ed25519 PKCS#8 DER öneki (RFC 8410): ham 32 bayttan anahtar kurmanın dizgisiz yolu. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export class KeyFileError extends Error {
  constructor(
    readonly kind: "YANLIS_PAROLA" | "BICIM" | "PAROLA_ZAYIF",
    message: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, KeyFileError.prototype);
  }
}

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const b64u = z.string().regex(/^[A-Za-z0-9_-]+$/);
const ClassList = z.array(z.enum(LICENSE_CLASSES)).min(1);

export const WrappedKeyFileSchema = z.strictObject({
  tur: z.enum(WRAPPED_KEY_TYPES),
  surum: z.literal(1),
  kid: z.string().regex(KID_PATTERN),
  siniflar: ClassList,
  x: b64u,
  kdf: z.strictObject({
    ad: z.literal("scrypt"),
    N: z.number().int().min(1 << 14).max(1 << 17),
    r: z.number().int().min(1).max(32),
    p: z.number().int().min(1).max(16),
    tuz: b64u,
  }),
  iv: b64u,
  sifreli: b64u,
  etiket: b64u,
  olusturma: z.string(),
  /** Yalnız BAYİ: kök imzalı sertifika (açık belge). */
  sertifika: z.string().optional(),
});
export type WrappedKeyFile = z.infer<typeof WrappedKeyFileSchema>;

export const SubKeyFileSchema = z.strictObject({
  tur: z.enum(SUB_KEY_TYPES),
  surum: z.literal(1),
  kid: z.string().regex(KID_PATTERN),
  x: b64u,
  d: b64u,
  sertifika: z.string().min(1),
  olusturma: z.string(),
});
export type SubKeyFile = z.infer<typeof SubKeyFileSchema>;

/** Parolayı NFC'ye getirip Buffer'a çevirir; çağıran iş bitince `.fill(0)` ile sıfırlar. */
export function passwordBuffer(password: string): Buffer {
  return Buffer.from(password.normalize("NFC"), "utf8");
}

export function assertPasswordStrength(password: Buffer): void {
  const length = [...password.toString("utf8")].length;
  if (length < MIN_ROOT_PASSWORD_LENGTH) {
    throw new KeyFileError("PAROLA_ZAYIF", `Parola en az ${MIN_ROOT_PASSWORD_LENGTH} karakter olmalı`);
  }
}

function aad(meta: { tur: string; kid: string; x: string; siniflar: readonly string[] }): Buffer {
  return Buffer.from(`tekserp/${meta.tur}|${meta.kid}|${meta.x}|${[...meta.siniflar].sort().join(",")}`, "utf8");
}

/** Ed25519 özel anahtarının ham 32 baytı (DER'den; ara Buffer sıfırlanır). */
export function rawPrivateKey(key: KeyObject): Buffer {
  const der = key.export({ format: "der", type: "pkcs8" });
  const raw = Buffer.from(der.subarray(der.length - RAW_KEY_LENGTH));
  der.fill(0);
  return raw;
}

/** Ham 32 bayttan Ed25519 özel anahtarı; ara DER Buffer'ı sıfırlanır (ham Buffer çağıranda). */
export function privateKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== RAW_KEY_LENGTH) throw new KeyFileError("BICIM", "Özel anahtar 32 bayt olmalı");
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, raw]);
  try {
    return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } finally {
    der.fill(0);
  }
}

export async function wrapPrivateKey(
  meta: { tur: WrappedKeyType; kid: string; siniflar: readonly LicenseClass[]; sertifika?: string },
  privateKey: KeyObject,
  password: Buffer,
): Promise<WrappedKeyFile> {
  assertPasswordStrength(password);
  const x = publicKeyX(privateKey);
  const salt = crypto.randomBytes(16);
  const kek = await scryptAsync(password, salt, 32, { ...SCRYPT_DEFAULT, maxmem: SCRYPT_MAXMEM });
  const raw = rawPrivateKey(privateKey);
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
    cipher.setAAD(aad({ tur: meta.tur, kid: meta.kid, x, siniflar: meta.siniflar }));
    const sealed = Buffer.concat([cipher.update(raw), cipher.final()]);
    return WrappedKeyFileSchema.parse({
      tur: meta.tur,
      surum: 1,
      kid: meta.kid,
      siniflar: [...meta.siniflar],
      x,
      kdf: { ad: "scrypt", ...SCRYPT_DEFAULT, tuz: salt.toString("base64url") },
      iv: iv.toString("base64url"),
      sifreli: sealed.toString("base64url"),
      etiket: cipher.getAuthTag().toString("base64url"),
      olusturma: new Date().toISOString(),
      ...(meta.sertifika ? { sertifika: meta.sertifika } : {}),
    });
  } finally {
    raw.fill(0);
    kek.fill(0);
  }
}

/**
 * Parolayla açar ve açık yarının dosyadakiyle eşleştiğini SABİT ZAMANLI denetler.
 * Dönen ham Buffer'ı çağıran iş bitince sıfırlar. Yanlış parola: GCM etiketi tutmaz.
 */
export async function unwrapPrivateKey(file: WrappedKeyFile, password: Buffer): Promise<Buffer> {
  const kek = await scryptAsync(password, Buffer.from(file.kdf.tuz, "base64url"), 32, {
    N: file.kdf.N,
    r: file.kdf.r,
    p: file.kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });
  let raw: Buffer | null = null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", kek, Buffer.from(file.iv, "base64url"));
    decipher.setAAD(aad(file));
    decipher.setAuthTag(Buffer.from(file.etiket, "base64url"));
    const head = decipher.update(Buffer.from(file.sifreli, "base64url"));
    const tail = decipher.final();
    raw = Buffer.concat([head, tail]);
    head.fill(0);
    tail.fill(0);
  } catch {
    throw new KeyFileError("YANLIS_PAROLA", "Parola hatalı ya da anahtar dosyası bozuk");
  } finally {
    kek.fill(0);
  }
  const derived = Buffer.from(publicKeyX(privateKeyFromRaw(raw)), "base64url");
  const stored = Buffer.from(file.x, "base64url");
  if (derived.length !== stored.length || !crypto.timingSafeEqual(derived, stored)) {
    raw.fill(0);
    throw new KeyFileError("BICIM", "Anahtar dosyasının açık yarısı özel yarısıyla eşleşmiyor");
  }
  return raw;
}

export function readWrappedKeyFile(filePath: string): WrappedKeyFile {
  const parsed = WrappedKeyFileSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
  if (!parsed.success) throw new KeyFileError("BICIM", `Sarılı anahtar dosyası tanınmıyor: ${filePath}`);
  return parsed.data;
}

export function readSubKeyFile(filePath: string): SubKeyFile {
  const parsed = SubKeyFileSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
  if (!parsed.success) throw new KeyFileError("BICIM", `Alt anahtar dosyası tanınmıyor: ${filePath}`);
  return parsed.data;
}

export function subKeyFileFor(tur: SubKeyType, kid: string, privateKey: KeyObject, certificate: string): SubKeyFile {
  const raw = rawPrivateKey(privateKey);
  try {
    return SubKeyFileSchema.parse({
      tur,
      surum: 1,
      kid,
      x: publicKeyX(privateKey),
      d: raw.toString("base64url"),
      sertifika: certificate,
      olusturma: new Date().toISOString(),
    });
  } finally {
    raw.fill(0);
  }
}

/** Alt anahtar dosyasındaki özel anahtar (açık yarı dosyadakiyle eşleşmeli). */
export function subKeyPrivate(file: SubKeyFile): KeyObject {
  const raw = Buffer.from(file.d, "base64url");
  try {
    const key = privateKeyFromRaw(raw);
    if (publicKeyX(key) !== file.x) throw new KeyFileError("BICIM", `Alt anahtar ${file.kid}: açık yarı uyuşmuyor`);
    return key;
  } finally {
    raw.fill(0);
  }
}

/** Anahtar dosyası yazımı: 0600, var olanın üstüne YAZMAZ (rotasyon yeni kid ile yeni dosyadır). */
export function writeKeyFileExclusive(filePath: string, content: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(filePath, 0o600);
}
