// JWS compact (RFC 7515) + EdDSA/Ed25519 (RFC 8037) — panel sürüm künyesinin imza katmanı, BAĞIMLILIKSIZ.
// Protokolün `Teks-Erp/src/lib/license/protocol/jws.ts` kurallarının aynasıdır (aynı hata kodları, aynı sıra):
// başlık dar allowlist (alg · typ · kid), alg ilk denetlenir, katı base64url, anahtar YALNIZ çapadan `kid` ile.
// Kâhin: `Teks-Erp/scripts/test_panel_imza.ts` — protokolün signJws'iyle bayt-eşit imza, verifyJws'iyle aynı kod.
import { createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

export const JWS_ALG = "EdDSA";
export const JWS_MAX_LENGTH = 32 * 1024;
const SIGNATURE_LENGTH = 64;
const PUBLIC_KEY_LENGTH = 32;
const ALLOWED_HEADER_FIELDS = new Set(["alg", "typ", "kid"]);
const KID_PATTERN = /^[a-z]+-[A-Za-z0-9_-]{1,64}$/;
const TYP_PATTERN = /^tekserp-[a-z]+$/;
/** Panel künyesini imzalayabilecek anahtar ailesi: PAKET (`paket-…`) ya da panel yayın anahtarı (`panel-…`). */
const SIGNER_KID_PATTERN = /^(?:paket|panel)-[a-z0-9-]{1,40}$/;
/** Hazırlık PAKET anahtarı parolasızdır (yalnız TEST/DEMO backend paketi): panel künyesini ASLA imzalayamaz. */
const STAGING_KID_PATTERN = /^paket-hazirlik/;
/** ÜRETİM çapasına girebilecek kid: `paket-<yıl>[-<n>]` ya da `panel-<yıl>[-<n>]` (test kid'leri bu biçimin dışında). */
export const PRODUCTION_SIGNER_KID = /^(?:paket|panel)-\d{4}(?:-\d{1,3})?$/;

export const ok = (value) => ({ ok: true, value });
export const fail = (code, message) => ({ ok: false, code, message });

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const B64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

/** Katı base64url: dolgu, yabancı karakter ve kanonik olmayan kuyruk RED (protokol `b64uDecode` aynası). */
export function b64uDecode(text) {
  if (typeof text !== "string" || !B64URL_PATTERN.test(text) || text.length % 4 === 1) return null;
  const data = Buffer.from(text, "base64url");
  return data.toString("base64url") === text ? data : null;
}

export const b64uEncode = (data) => Buffer.from(data).toString("base64url");

function decodeJsonPart(part) {
  const raw = b64uDecode(part);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return undefined;
  }
}

function checkHeader(raw) {
  if (!isPlainObject(raw)) return fail("JWS_BICIM", "JWS başlığı bir JSON nesnesi değil");
  // alg ilk denetlenir: `none` ya da simetrik alg taşıyan belge başka hiçbir alana bakılmadan düşer.
  if (raw.alg !== JWS_ALG) return fail("JWS_ALG", `Desteklenmeyen imza algoritması: ${String(raw.alg)}`);
  for (const field of Object.keys(raw)) {
    if (!ALLOWED_HEADER_FIELDS.has(field)) return fail("JWS_BASLIK", `İzin verilmeyen başlık alanı: ${field}`);
  }
  if (typeof raw.typ !== "string" || !TYP_PATTERN.test(raw.typ)) return fail("JWS_TYP", "Belge türü (typ) eksik ya da geçersiz");
  if (typeof raw.kid !== "string" || !KID_PATTERN.test(raw.kid)) return fail("JWS_KID", "Anahtar kimliği (kid) eksik ya da geçersiz");
  return ok({ alg: JWS_ALG, typ: raw.typ, kid: raw.kid });
}

/** İmzayı DOĞRULAMADAN ayrıştırır (protokol `parseJws` aynası). */
export function parseJws(token) {
  if (typeof token !== "string" || token.length === 0 || token.length > JWS_MAX_LENGTH) {
    return fail("JWS_BICIM", "JWS metni boş, metin değil ya da çok uzun");
  }
  const parts = token.split(".");
  if (parts.length !== 3) return fail("JWS_BICIM", "JWS üç parçalı olmalı");
  const [b64Header, b64Payload, b64Signature] = parts;
  const header = checkHeader(decodeJsonPart(b64Header));
  if (!header.ok) return header;
  const payload = decodeJsonPart(b64Payload);
  if (!isPlainObject(payload)) return fail("JWS_BICIM", "JWS yükü bir JSON nesnesi değil");
  const signature = b64uDecode(b64Signature);
  if (!signature || signature.length !== SIGNATURE_LENGTH) return fail("JWS_BICIM", "İmza parçası geçersiz");
  return ok({ header: header.value, payload, signingInput: Buffer.from(`${b64Header}.${b64Payload}`, "ascii"), signature });
}

/** Ham 32 baytlık Ed25519 açık anahtarı (base64url `x`) → anahtar nesnesi; biçimsizse null. */
export function publicKeyFromX(x) {
  const raw = b64uDecode(x);
  if (!raw || raw.length !== PUBLIC_KEY_LENGTH) return null;
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
  } catch {
    return null;
  }
}

/** Panel künyesini imzalayabilecek kid mi (aile + hazırlık değil)? */
export function isSignerKid(kid) {
  return typeof kid === "string" && SIGNER_KID_PATTERN.test(kid) && !STAGING_KID_PATTERN.test(kid);
}

/**
 * Çapa → kid eşlemi. Çapa KODDUR: tek bozuk satır (biçimsiz kid/anahtar, hazırlık kid'i, tekrar) bütün çapayı
 * GEÇERSİZ kılar — sessizce ayıklamak, yanlış paketlenmiş bir panelin "yarım" güvenle koşması demek olurdu.
 */
export function anchorLookup(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return fail("CAPA_BOS", "İmza çapası boş — bu panel hiçbir güncellemeyi doğrulayamaz");
  const map = new Map();
  const seen = new Set();
  for (const k of keys) {
    const kid = isPlainObject(k) ? k.kid : undefined;
    const x = isPlainObject(k) ? k.x : undefined;
    if (!isSignerKid(kid)) return fail("CAPA_GECERSIZ", `Çapada izin verilmeyen anahtar kimliği: ${String(kid)}`);
    const key = typeof x === "string" ? publicKeyFromX(x) : null;
    if (!key) return fail("CAPA_GECERSIZ", `Çapadaki açık anahtar geçersiz: ${kid}`);
    if (map.has(kid) || seen.has(x)) return fail("CAPA_GECERSIZ", `Çapada tekrar eden anahtar: ${kid}`);
    map.set(kid, key);
    seen.add(x);
  }
  return ok(map);
}

/** Üretim çapası (paketlenecek panelin gömülü listesi): çalışma anı kuralına EK olarak kid'in yıl biçimi. */
export function checkProductionAnchor(keys) {
  const a = anchorLookup(keys);
  if (!a.ok) return a;
  const odd = keys.map((k) => k.kid).filter((kid) => !PRODUCTION_SIGNER_KID.test(kid));
  return odd.length ? fail("CAPA_GECERSIZ", `Üretim çapasında üretim biçiminde olmayan kid: ${odd.join(", ")}`) : a;
}

/** İmzayı çapayla doğrular; `typ` beklenenden farklıysa çapraz protokol karışması sayılır ve RED. */
export function verifyJwsWithAnchor(token, { typ, keys }) {
  const anchor = anchorLookup(keys);
  if (!anchor.ok) return anchor;
  const parsed = parseJws(token);
  if (!parsed.ok) return parsed;
  const { header, signingInput, signature } = parsed.value;
  if (header.typ !== typ) return fail("JWS_TYP", `Beklenen belge türü ${typ}, gelen ${header.typ}`);
  const key = anchor.value.get(header.kid);
  if (!key) return fail("JWS_KID", `Bilinmeyen anahtar kimliği: ${header.kid}`);
  let valid = false;
  try {
    valid = edVerify(null, signingInput, key, signature);
  } catch {
    valid = false;
  }
  return valid ? parsed : fail("JWS_IMZA", "İmza doğrulanamadı");
}

/** İmzalar (protokol `signJws` ile bayt-eşit: aynı başlık sırası, aynı JSON, deterministik Ed25519). */
export function signJwsCompact({ typ, kid, payload, privateKey }) {
  if (!privateKey || privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("signJwsCompact: yalnız Ed25519 özel anahtarı kabul edilir");
  }
  if (!TYP_PATTERN.test(typ) || !isSignerKid(kid)) throw new Error(`signJwsCompact: typ ya da kid uygun değil (${typ} · ${kid})`);
  const header = b64uEncode(JSON.stringify({ alg: JWS_ALG, typ, kid }));
  const body = b64uEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const token = `${signingInput}.${b64uEncode(edSign(null, Buffer.from(signingInput, "ascii"), privateKey))}`;
  if (token.length > JWS_MAX_LENGTH) throw new Error("signJwsCompact: belge azami uzunluğu aşıyor");
  return token;
}
