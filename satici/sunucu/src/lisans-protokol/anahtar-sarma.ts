// Anahtar dosyası SARMASI — tek uygulama: satıcının kök/bayi anahtarları (`satici/sunucu/src/keys/key-files.ts`)
// ve imza aracının üretim PAKET anahtarı (`Teks-Erp/scripts/lib/butunluk-imza.ts`). Özel yarı scrypt(parola) →
// AES-256-GCM ile sarılır; ek veri (AAD) tür + kid + açık yarı + sınıfları bağlar — alanlar kopartılıp başka
// dosyaya takılamaz. Parola Buffer olarak dolaşır ve iş bitince sıfırlanır; dosya G/Ç'si çağıranda.
import crypto, { type KeyObject } from "node:crypto";
import { publicKeyX } from "./jws";

/** Kök/PAKET parolasının alt sınırı — anahtar tek başına bütün lisansları ya da paketleri imzalar. */
export const MIN_KEY_PASSWORD_LENGTH = 12;
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

function scryptAsync(password: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, options: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Sarmanın bağladığı üst veri: tür + kid + açık yarı + sınıflar. */
export interface KeyWrapMeta {
  readonly tur: string;
  readonly kid: string;
  readonly x: string;
  readonly siniflar: readonly string[];
}

/** Dosyadaki sarılı özel yarı (kripto alanları). */
export interface SealedKey {
  readonly kdf: { readonly ad: "scrypt"; readonly N: number; readonly r: number; readonly p: number; readonly tuz: string };
  readonly iv: string;
  readonly sifreli: string;
  readonly etiket: string;
}

/** Parolayı NFC'ye getirip Buffer'a çevirir; çağıran iş bitince `.fill(0)` ile sıfırlar. */
export function passwordBuffer(password: string): Buffer {
  return Buffer.from(password.normalize("NFC"), "utf8");
}

export function assertPasswordStrength(password: Buffer): void {
  const length = [...password.toString("utf8")].length;
  if (length < MIN_KEY_PASSWORD_LENGTH) {
    throw new KeyFileError("PAROLA_ZAYIF", `Parola en az ${MIN_KEY_PASSWORD_LENGTH} karakter olmalı`);
  }
}

function aad(meta: KeyWrapMeta): Buffer {
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

/** Özel yarıyı parolayla sarar; açık yarı (`x`) + dosyanın kripto alanları döner. Zayıf parola PAROLA_ZAYIF. */
export async function sealPrivateKey(
  meta: Omit<KeyWrapMeta, "x">,
  privateKey: KeyObject,
  password: Buffer,
): Promise<{ readonly x: string } & SealedKey> {
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
    return {
      x,
      kdf: { ad: "scrypt", ...SCRYPT_DEFAULT, tuz: salt.toString("base64url") },
      iv: iv.toString("base64url"),
      sifreli: sealed.toString("base64url"),
      etiket: cipher.getAuthTag().toString("base64url"),
    };
  } finally {
    raw.fill(0);
    kek.fill(0);
  }
}

/**
 * Parolayla açar ve açık yarının dosyadakiyle eşleştiğini SABİT ZAMANLI denetler.
 * Dönen ham Buffer'ı çağıran iş bitince sıfırlar. Yanlış parola: GCM etiketi tutmaz.
 */
export async function openSealedKey(file: KeyWrapMeta & SealedKey, password: Buffer): Promise<Buffer> {
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
