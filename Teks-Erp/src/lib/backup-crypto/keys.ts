// =============================================================================
// Yedek şifreleme — X25519 anahtarları, metin biçimleri ve parolayla sarma
// =============================================================================
// Metin biçimleri kâğıda yazılabilecek TEK SATIR olsun diye seçildi:
//   açık  : `tkpub1:<base64url(32 bayt anahtar ‖ 4 bayt SHA-256 sağlaması)>`
//   özel  : `tksec1:<…aynı düzen…>`
// Sağlama bir yazım hatasını "yanlış anahtar"dan AYIRIR — kâğıttan geri yazılan
// anahtarda operatör hangisini düzelteceğini bilmeli.
//
// Sarılı özel anahtar (`*.tkkey`) JSON'dur: scrypt(parola) → AES-256-GCM; ek veri
// (AAD) açık anahtarı bağlar, alanlar birbirinden kopartılıp takılamaz.
// =============================================================================

import crypto, { type KeyObject } from "crypto";
import { promisify } from "util";
import { BackupCryptoError, TKENC_VERSION } from "./format";

const PUB_PREFIX = "tkpub1:";
const SEC_PREFIX = "tksec1:";
const KEY_LEN = 32;
const CHECKSUM_LEN = 4;
// X25519 PKCS#8 DER öneki (RFC 8410) — ham 32 bayttan KeyObject kurmanın bağımlılıksız yolu.
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

/** scrypt parametreleri dosyaya yazılır; burada yalnız YENİ sarma için varsayılan. */
const SCRYPT_DEFAULT = { N: 1 << 16, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
/** Yedek parolasının alt sınırı — tek başına bütün geçmiş yedekleri açar. */
export const MIN_PASSWORD_LENGTH = 10;

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

export const b64u = (b: Buffer): string => b.toString("base64url");
export function fromB64u(s: string, beklenen?: number): Buffer {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) {
    throw new BackupCryptoError("BICIM", "Base64url alanı okunamadı.");
  }
  const b = Buffer.from(s, "base64url");
  if (beklenen !== undefined && b.length !== beklenen) {
    throw new BackupCryptoError("BICIM", `Alan uzunluğu ${beklenen} bayt olmalı, ${b.length} bulundu.`);
  }
  return b;
}

export interface RawKeyPair {
  publicRaw: Buffer;
  privateRaw: Buffer;
}

export function generateRawKeyPair(): RawKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return { publicRaw: rawPublic(publicKey), privateRaw: rawPrivate(privateKey) };
}

export function rawPublic(k: KeyObject): Buffer {
  const jwk = k.export({ format: "jwk" });
  return fromB64u(String(jwk.x), KEY_LEN);
}

export function rawPrivate(k: KeyObject): Buffer {
  const jwk = k.export({ format: "jwk" });
  return fromB64u(String(jwk.d), KEY_LEN);
}

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== KEY_LEN) throw new BackupCryptoError("ANAHTAR_BICIMI", "Açık anahtar 32 bayt olmalı.");
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64u(raw) }, format: "jwk" });
}

export function privateKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== KEY_LEN) throw new BackupCryptoError("ANAHTAR_BICIMI", "Özel anahtar 32 bayt olmalı.");
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
}

export function publicRawOfPrivate(privateRaw: Buffer): Buffer {
  return rawPublic(crypto.createPublicKey(privateKeyFromRaw(privateRaw)));
}

/** SHA-256(açık anahtar) ilk 8 bayt, hex. Başlıkta alıcıyı tanıtır; sır değildir. */
export function fingerprint(publicRaw: Buffer): string {
  return crypto.createHash("sha256").update(publicRaw).digest().subarray(0, 8).toString("hex");
}

function withChecksum(raw: Buffer): string {
  const sum = crypto.createHash("sha256").update(raw).digest().subarray(0, CHECKSUM_LEN);
  return b64u(Buffer.concat([raw, sum]));
}

function decodeChecked(text: string, prefix: string, tur: string): Buffer {
  const t = text.trim();
  if (!t.startsWith(prefix)) {
    throw new BackupCryptoError("ANAHTAR_BICIMI", `${tur} "${prefix}" ile başlamalı.`);
  }
  let body: Buffer;
  try {
    body = fromB64u(t.slice(prefix.length), KEY_LEN + CHECKSUM_LEN);
  } catch {
    throw new BackupCryptoError("ANAHTAR_BICIMI", `${tur} uzunluğu/karakterleri hatalı — eksik ya da fazla karakter.`);
  }
  const raw = body.subarray(0, KEY_LEN);
  const sum = crypto.createHash("sha256").update(raw).digest().subarray(0, CHECKSUM_LEN);
  if (!crypto.timingSafeEqual(sum, body.subarray(KEY_LEN))) {
    throw new BackupCryptoError("ANAHTAR_BICIMI", `${tur} sağlaması tutmuyor — yazım hatası var.`);
  }
  return Buffer.from(raw);
}

export const encodePublicKey = (raw: Buffer): string => `${PUB_PREFIX}${withChecksum(raw)}`;
export const encodeSecretKey = (raw: Buffer): string => `${SEC_PREFIX}${withChecksum(raw)}`;
export const decodePublicKey = (text: string): Buffer => decodeChecked(text, PUB_PREFIX, "Açık anahtar");
export const decodeSecretKey = (text: string): Buffer => decodeChecked(text, SEC_PREFIX, "Özel anahtar");

/** Anahtar dosyasındaki ilk anlamlı satır (`#` yorum ve boş satırlar atlanır). */
export function firstKeyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s && !s.startsWith("#")) return s;
  }
  throw new BackupCryptoError("ANAHTAR_BICIMI", "Anahtar dosyası boş.");
}

// -----------------------------------------------------------------------------
// Parolayla sarılı özel anahtar
// -----------------------------------------------------------------------------

export interface WrappedKeyFile {
  tur: "tkenc-sarili-anahtar";
  surum: number;
  ad: string;
  acik: string;
  kdf: { ad: "scrypt"; N: number; r: number; p: number; tuz: string };
  iv: string;
  sifreli: string;
  etiket: string;
}

function aadFor(ad: string, acik: string): Buffer {
  return Buffer.from(`tkenc/sarili-anahtar|${ad}|${acik}`, "utf8");
}

export function validatePasswordStrength(password: string): void {
  if ([...password.normalize("NFC")].length < MIN_PASSWORD_LENGTH) {
    throw new BackupCryptoError(
      "YANLIS_PAROLA",
      `Yedek parolası en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`,
    );
  }
}

export async function wrapSecretKey(ad: string, privateRaw: Buffer, password: string): Promise<WrappedKeyFile> {
  validatePasswordStrength(password);
  const publicText = encodePublicKey(publicRawOfPrivate(privateRaw));
  const salt = crypto.randomBytes(16);
  const kek = await scryptAsync(password.normalize("NFC"), salt, 32, { ...SCRYPT_DEFAULT, maxmem: SCRYPT_MAXMEM });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", kek, iv);
  c.setAAD(aadFor(ad, publicText));
  const sealed = Buffer.concat([c.update(privateRaw), c.final()]);
  kek.fill(0);
  return {
    tur: "tkenc-sarili-anahtar",
    surum: TKENC_VERSION,
    ad,
    acik: publicText,
    kdf: { ad: "scrypt", ...SCRYPT_DEFAULT, tuz: b64u(salt) },
    iv: b64u(iv),
    sifreli: b64u(sealed),
    etiket: b64u(c.getAuthTag()),
  };
}

export function parseWrappedKeyFile(text: string): WrappedKeyFile {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new BackupCryptoError("ANAHTAR_BICIMI", "Sarılı anahtar dosyası JSON değil.");
  }
  const w = j as Partial<WrappedKeyFile>;
  const kdf = w.kdf as WrappedKeyFile["kdf"] | undefined;
  const ok =
    w.tur === "tkenc-sarili-anahtar" &&
    w.surum === TKENC_VERSION &&
    typeof w.ad === "string" &&
    typeof w.acik === "string" &&
    typeof w.iv === "string" &&
    typeof w.sifreli === "string" &&
    typeof w.etiket === "string" &&
    !!kdf &&
    kdf.ad === "scrypt" &&
    Number.isInteger(kdf.N) && kdf.N >= 1 << 14 && kdf.N <= 1 << 17 && (kdf.N & (kdf.N - 1)) === 0 &&
    Number.isInteger(kdf.r) && kdf.r >= 1 && kdf.r <= 32 &&
    Number.isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= 16 &&
    typeof kdf.tuz === "string";
  if (!ok) throw new BackupCryptoError("ANAHTAR_BICIMI", "Sarılı anahtar dosyasının alanları eksik ya da tanınmıyor.");
  decodePublicKey(w.acik!);
  return w as WrappedKeyFile;
}

/** Parolayla açar; yanlış parola `YANLIS_PAROLA` (GCM etiketi tutmaz). */
export async function unwrapSecretKey(w: WrappedKeyFile, password: string): Promise<Buffer> {
  const kek = await scryptAsync(password.normalize("NFC"), fromB64u(w.kdf.tuz), 32, {
    N: w.kdf.N,
    r: w.kdf.r,
    p: w.kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", kek, fromB64u(w.iv, 12));
    d.setAAD(aadFor(w.ad, w.acik));
    d.setAuthTag(fromB64u(w.etiket, 16));
    const raw = Buffer.concat([d.update(fromB64u(w.sifreli, KEY_LEN)), d.final()]);
    if (!publicRawOfPrivate(raw).equals(decodePublicKey(w.acik))) {
      throw new BackupCryptoError("ANAHTAR_BICIMI", "Sarılı anahtarın açık yarısı özel yarısıyla eşleşmiyor.");
    }
    return raw;
  } catch (e) {
    if (e instanceof BackupCryptoError) throw e;
    throw new BackupCryptoError("YANLIS_PAROLA", "Yedek parolası hatalı.");
  } finally {
    kek.fill(0);
  }
}

/**
 * Özel anahtar metni: sarılı JSON (`*.tkkey`) ya da düz `tksec1:` satırı.
 * Sarılıysa parola `sor` ile istenir — parola argümandan ALINMAZ.
 */
export async function privateRawFromText(text: string, sor: () => Promise<string>): Promise<Buffer> {
  const t = text.trim();
  if (t.startsWith("{")) return unwrapSecretKey(parseWrappedKeyFile(t), await sor());
  return decodeSecretKey(firstKeyLine(t));
}
