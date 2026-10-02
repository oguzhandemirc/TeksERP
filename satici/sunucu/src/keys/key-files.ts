// Satıcı anahtar dosyaları.
//   KÖK / hazırlık kökü / BAYİ / HAK ARA İMZACISI: özel yarı scrypt(parola) → AES-256-GCM ile SARILI (parolasız okunamaz);
//     ek veri (AAD) tür + kid + açık yarı + sınıfları bağlar — alanlar kopartılıp başka dosyaya takılamaz.
//     Sarmanın TEK uygulaması protokoldedir (`lisans-protokol/anahtar-sarma.ts`; imza aracının PAKET anahtarı da onu kullanır).
//   ALT (kira) / İNDİRME: otomatik imza için parolasız, 0600; kök imzalı sertifika dosyanın içinde.
//   EMEKLİ (`*.sertifika.json`): dönem töreninden sonra özel yarısı silinen ALT · İNDİRME · ARA anahtarının YALNIZ açık
//     yarısı + sertifikası (eski belgeler onunla doğrulanır; imzada kullanılmaz).
// Parola Buffer olarak dolaşır ve iş bitince sıfırlanır; string'e çevrilmez (V8 string'i silinemez).
import type { KeyObject } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { LICENSE_CLASSES, KID_PATTERN, publicKeyX, type LicenseClass } from "../lisans-protokol";
import {
  KeyFileError,
  MIN_KEY_PASSWORD_LENGTH,
  assertPasswordStrength,
  openSealedKey,
  passwordBuffer,
  privateKeyFromRaw,
  rawPrivateKey,
  sealPrivateKey,
} from "../lisans-protokol/anahtar-sarma";

export { KeyFileError, assertPasswordStrength, passwordBuffer, privateKeyFromRaw, rawPrivateKey };

/** Ara imzacı (`tekserp-ara-anahtar`) da sarılıdır: parolası portal formundan imza alt sürecinin stdin'ine gider. */
export const WRAPPED_KEY_TYPES = ["tekserp-kok-anahtar", "tekserp-bayi-anahtar", "tekserp-ara-anahtar"] as const;
export type WrappedKeyType = (typeof WRAPPED_KEY_TYPES)[number];
export const SUB_KEY_TYPES = ["tekserp-alt-anahtar", "tekserp-indirme-anahtar"] as const;
export type SubKeyType = (typeof SUB_KEY_TYPES)[number];

/** Kök parolasının alt sınırı — tek başına bütün lisansları imzalar. */
export const MIN_ROOT_PASSWORD_LENGTH = MIN_KEY_PASSWORD_LENGTH;

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
  /** BAYİ ve ARA: kök imzalı sertifika (açık belge); kökte yok. */
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

/** Emekli anahtar künyesi — özel yarısı SİLİNMİŞ anahtarın açık yarısı + sertifikası (imzada kullanılmaz). */
export const RETIRED_KEY_TYPE = "tekserp-emekli-anahtar";
export const RetiredKeyFileSchema = z.strictObject({
  tur: z.literal(RETIRED_KEY_TYPE),
  surum: z.literal(1),
  kid: z.string().regex(KID_PATTERN),
  /** Emekliye ayrılan dosyanın türü (ALT · İNDİRME · ARA). */
  kaynakTur: z.enum(["tekserp-alt-anahtar", "tekserp-indirme-anahtar", "tekserp-ara-anahtar"]),
  x: b64u,
  sertifika: z.string().min(1),
  emeklilik: z.string(),
});
export type RetiredKeyFile = z.infer<typeof RetiredKeyFileSchema>;

export function readRetiredKeyFile(filePath: string): RetiredKeyFile {
  const parsed = RetiredKeyFileSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
  if (!parsed.success) throw new KeyFileError("BICIM", `Emekli anahtar künyesi tanınmıyor: ${filePath}`);
  return parsed.data;
}

export async function wrapPrivateKey(
  meta: { tur: WrappedKeyType; kid: string; siniflar: readonly LicenseClass[]; sertifika?: string },
  privateKey: KeyObject,
  password: Buffer,
): Promise<WrappedKeyFile> {
  const sealed = await sealPrivateKey({ tur: meta.tur, kid: meta.kid, siniflar: meta.siniflar }, privateKey, password);
  return WrappedKeyFileSchema.parse({
    tur: meta.tur,
    surum: 1,
    kid: meta.kid,
    siniflar: [...meta.siniflar],
    x: sealed.x,
    kdf: sealed.kdf,
    iv: sealed.iv,
    sifreli: sealed.sifreli,
    etiket: sealed.etiket,
    olusturma: new Date().toISOString(),
    ...(meta.sertifika ? { sertifika: meta.sertifika } : {}),
  });
}

/**
 * Parolayla açar ve açık yarının dosyadakiyle eşleştiğini SABİT ZAMANLI denetler.
 * Dönen ham Buffer'ı çağıran iş bitince sıfırlar. Yanlış parola: GCM etiketi tutmaz.
 */
export function unwrapPrivateKey(file: WrappedKeyFile, password: Buffer): Promise<Buffer> {
  return openSealedKey(file, password);
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
