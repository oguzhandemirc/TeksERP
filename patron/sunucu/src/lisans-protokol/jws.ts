// JWS compact (RFC 7515) + EdDSA/Ed25519 (RFC 8037) — dış kütüphane yok, yalnız node:crypto.
// Başlık DAR bir allowlist'tir (alg · typ · kid): gömülü anahtar (`jwk`/`x5c`), `crit`
// ve başka her alan RED — anahtar daima güven çapasından `kid` ile seçilir.
import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { b64uDecode, b64uEncode, success, isPlainObject, failure, type Result } from "./ortak";

export const JWS_ALG = "EdDSA";
/** Gömülü sertifikalı en büyük belge birkaç KB'dır; tavan ayrıştırma saldırısını keser. */
export const JWS_MAX_LENGTH = 32 * 1024;
const SIGNATURE_LENGTH = 64;
const PUBLIC_KEY_LENGTH = 32;
const ALLOWED_HEADER_FIELDS = new Set(["alg", "typ", "kid"]);
export const KID_PATTERN = /^[a-z]+-[A-Za-z0-9_-]{1,64}$/;
const TYP_PATTERN = /^tekserp-[a-z]+$/;

export interface JwsHeader {
  readonly alg: typeof JWS_ALG;
  readonly typ: string;
  readonly kid: string;
}

export interface ParsedJws {
  readonly header: JwsHeader;
  readonly payload: Record<string, unknown>;
  readonly signingInput: Buffer;
  readonly signature: Buffer;
}

function decodeJsonPart(part: string): unknown {
  const raw = b64uDecode(part);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return undefined;
  }
}

function checkHeader(raw: unknown): Result<JwsHeader> {
  if (!isPlainObject(raw)) return failure("JWS_BICIM", "JWS başlığı bir JSON nesnesi değil");
  // alg ilk denetlenir: `none` ya da simetrik alg taşıyan belge başka hiçbir alana bakılmadan düşer.
  if (raw.alg !== JWS_ALG) return failure("JWS_ALG", `Desteklenmeyen imza algoritması: ${String(raw.alg)}`);
  for (const field of Object.keys(raw)) {
    if (!ALLOWED_HEADER_FIELDS.has(field)) return failure("JWS_BASLIK", `İzin verilmeyen başlık alanı: ${field}`);
  }
  if (typeof raw.typ !== "string" || !TYP_PATTERN.test(raw.typ)) return failure("JWS_TYP", "Belge türü (typ) eksik ya da geçersiz");
  if (typeof raw.kid !== "string" || !KID_PATTERN.test(raw.kid)) return failure("JWS_KID", "Anahtar kimliği (kid) eksik ya da geçersiz");
  return success({ alg: JWS_ALG, typ: raw.typ, kid: raw.kid });
}

/** İmzayı DOĞRULAMADAN ayrıştırır — yalnız anahtar bulmak ya da gömülü sertifikayı çıkarmak için. */
export function parseJws(token: unknown): Result<ParsedJws> {
  if (typeof token !== "string" || token.length === 0 || token.length > JWS_MAX_LENGTH) {
    return failure("JWS_BICIM", "JWS metni boş, metin değil ya da çok uzun");
  }
  const parts = token.split(".");
  if (parts.length !== 3) return failure("JWS_BICIM", "JWS üç parçalı olmalı");
  const [b64Header, b64Payload, b64Signature] = parts;
  const header = checkHeader(decodeJsonPart(b64Header));
  if (!header.ok) return header;
  const payload = decodeJsonPart(b64Payload);
  if (!isPlainObject(payload)) return failure("JWS_BICIM", "JWS yükü bir JSON nesnesi değil");
  const signature = b64uDecode(b64Signature);
  if (!signature || signature.length !== SIGNATURE_LENGTH) return failure("JWS_BICIM", "İmza parçası geçersiz");
  return success({
    header: header.value,
    payload,
    signingInput: Buffer.from(`${b64Header}.${b64Payload}`, "ascii"),
    signature,
  });
}

function isEd25519Public(key: KeyObject): boolean {
  return key.type === "public" && key.asymmetricKeyType === "ed25519";
}

export interface JwsVerifyOptions {
  /** Beklenen belge türü; farklı typ çapraz protokol karışması sayılır ve RED. */
  readonly typ: string;
  /** `kid` → açık anahtar; bilinmeyen kid için `undefined`. */
  readonly findKey: (kid: string) => KeyObject | undefined;
}

export function verifyJws(token: unknown, options: JwsVerifyOptions): Result<ParsedJws> {
  const parsed = parseJws(token);
  if (!parsed.ok) return parsed;
  const { header, signingInput, signature } = parsed.value;
  if (header.typ !== options.typ) {
    return failure("JWS_TYP", `Beklenen belge türü ${options.typ}, gelen ${header.typ}`);
  }
  const key = options.findKey(header.kid);
  if (!key || !isEd25519Public(key)) return failure("JWS_KID", `Bilinmeyen anahtar kimliği: ${header.kid}`);
  let valid = false;
  try {
    valid = verify(null, signingInput, key, signature);
  } catch {
    valid = false;
  }
  return valid ? parsed : failure("JWS_IMZA", "İmza doğrulanamadı");
}

export interface JwsSignInput {
  readonly typ: string;
  readonly kid: string;
  readonly payload: Record<string, unknown>;
  readonly privateKey: KeyObject;
}

/** İmzalar; anahtar ya da başlık yanlışsa programcı hatasıdır ve fırlatır. */
export function signJws(g: JwsSignInput): string {
  if (g.privateKey.type !== "private" || g.privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("signJws: yalnız Ed25519 özel anahtarı kabul edilir");
  }
  if (!TYP_PATTERN.test(g.typ) || !KID_PATTERN.test(g.kid)) throw new Error("signJws: typ ya da kid biçimsiz");
  const header = b64uEncode(JSON.stringify({ alg: JWS_ALG, typ: g.typ, kid: g.kid }));
  const payload = b64uEncode(JSON.stringify(g.payload));
  const signingInput = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput, "ascii"), g.privateKey);
  const token = `${signingInput}.${b64uEncode(signature)}`;
  if (token.length > JWS_MAX_LENGTH) throw new Error("signJws: belge azami uzunluğu aşıyor");
  return token;
}

/** Ham 32 baytlık Ed25519 açık anahtarını (base64url `x`) anahtar nesnesine çevirir. */
export function publicKeyFromX(x: string): KeyObject | null {
  const raw = b64uDecode(x);
  if (!raw || raw.length !== PUBLIC_KEY_LENGTH) return null;
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
  } catch {
    return null;
  }
}

/** Özel ya da açık anahtardan ham açık anahtarı (base64url `x`) çıkarır. */
export function publicKeyX(key: KeyObject): string {
  const publicKey = key.type === "private" ? createPublicKey(key) : key;
  if (!isEd25519Public(publicKey)) throw new Error("publicKeyX: Ed25519 anahtarı değil");
  const jwk = publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("publicKeyX: anahtar dışa aktarılamadı");
  return jwk.x;
}

/** Belgenin bayt özeti: compact JWS metninin sha256'sı, base64url (43). Kira HAK'a (`hakOzeti`), yoklama HAK'ı bununla bağlar. */
export function jwsDigest(token: string): string {
  return b64uEncode(createHash("sha256").update(token, "utf8").digest());
}

/** Kurulum anahtarının kimliği: `kur-` + sha256(ham açık anahtar), base64url. */
export function installationKeyId(x: string): string {
  const raw = b64uDecode(x);
  if (!raw || raw.length !== PUBLIC_KEY_LENGTH) throw new Error("installationKeyId: açık anahtar biçimsiz");
  return `kur-${b64uEncode(createHash("sha256").update(raw).digest())}`;
}
