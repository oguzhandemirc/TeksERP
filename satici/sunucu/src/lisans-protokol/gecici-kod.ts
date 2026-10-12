// GEÇİCİ AÇILIŞ KODU (yazarak etkinleştirme) — internetsiz, karekodsuz kurulumun telefonla okunan iki kısa kodu.
// İstek kodu fabrikanın ekranındadır (anahtar özeti + rastgele ek); açılış kodu yalnız fabrikanın BİLMEDİĞİ alanları ve
// kökün Ed25519 imzasını taşır. İmza, istek kodunu da içeren bir JWS'in imzasıdır: fabrika JWS'i yerelden yeniden kurar
// ve mevcut doğrulayıcıdan geçirir (yeni imza biçimi yok). Kodda sertifika taşınamaz ⇒ yalnız gömülü KÖK imzalar.
import { createHash } from "node:crypto";
import { z } from "zod";
import { b64uDecode, b64uEncode } from "./ortak";
import { JWS_ALG } from "./jws";

/** Crockford base32 (I/L/O/U yok); okunurken O→0, I/L→1 düzeltilir. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TEMP_CODE_PREFIX = "TG";
export const TEMP_REQUEST_PREFIX = "TI";
export const TEMP_CODE_GROUP = 5;
/** 71 bayt veri = 114 karakter + 1 sağlama karakteri = 23 × 5. */
export const TEMP_CODE_LENGTH = 115;
const REQUEST_GROUP = 4;
/** 15 bayt = 24 karakter = 6 × 4. */
export const TEMP_REQUEST_LENGTH = 24;
const CODE_VERSION = 1;
const SIG_LENGTH = 64;
const CODE_BYTES = 1 + 1 + 3 + 2 + SIG_LENGTH;
const REQUEST_BYTES = 15;
const KID_PREFIX_BYTES = 8;
/** Gün sayacının başlangıcı (UTC); `bitisGunu` bu günden sayılır. */
const DAY_EPOCH_MS = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
export const TEMP_CODE_DAYS = { varsayilan: 30, enAz: 7, enCok: 90 } as const;

export const TYP_GECICI = "tekserp-gecici";

/** İmzalanan yük — fabrika aynı nesneyi aynı sırayla yeniden kurar (JSON alan sırası imzanın parçasıdır). */
export const TempOpeningSchema = z.strictObject({
  v: z.literal(CODE_VERSION),
  istekKodu: z.string().regex(new RegExp(`^[${ALPHABET}]{${TEMP_REQUEST_LENGTH}}$`)),
  kodId: z.number().int().min(0).max(0xffffff),
  bitisGunu: z.number().int().min(0).max(0xffff),
});
export type TempOpeningDoc = z.infer<typeof TempOpeningSchema>;

export type TempCodeRejection = "BICIM" | "KARAKTER" | "SAGLAMA" | "SURUM" | "IMZACI";
export type TempCodeParse<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly neden: TempCodeRejection; readonly konum?: number };

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string, byteLength: number): Uint8Array | null {
  const out = new Uint8Array(byteLength);
  let bits = 0;
  let acc = 0;
  let i = 0;
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      if (i < byteLength) out[i] = (acc >>> (bits - 8)) & 0xff;
      i++;
      bits -= 8;
    }
  }
  return i >= byteLength ? out : null;
}

function checkChar(data: string): string {
  return ALPHABET[createHash("sha256").update(data, "ascii").digest()[0] & 31];
}

/**
 * Yazılan metni tek biçime indirger: ön ek, tire, boşluk atılır; büyük harf; O→0, I/L→1. Alfabe dışı karakter
 * (U, Türkçe harf…) KORUNUR ki ekran yerini gösterebilsin.
 */
export function normalizeTempText(raw: string, prefix: string): string {
  let t = raw.toUpperCase().replace(/[\s\-_.]/g, "");
  if (t.startsWith(prefix)) t = t.slice(prefix.length);
  return t.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** İlk alfabe dışı karakterin yeri (yoksa -1) — ekranın "yanlış karakter" işareti. */
export function firstInvalidTempChar(normalized: string): number {
  for (let i = 0; i < normalized.length; i++) if (!ALPHABET.includes(normalized[i])) return i;
  return -1;
}

function group(text: string, size: number, prefix: string): string {
  return [prefix, ...(text.match(new RegExp(`.{1,${size}}`, "g")) ?? [])].join("-");
}

/** Anahtar kimliğinin (`kur-<b64u sha256>`) ilk 8 baytı — istek kodunu kurulum anahtarına bağlar. */
function kidPrefix(installationKid: string): Uint8Array {
  const raw = b64uDecode(installationKid.replace(/^kur-/, ""));
  if (!raw || raw.length < KID_PREFIX_BYTES) throw new Error("gecici-kod: anahtar kimliği biçimsiz");
  return raw.subarray(0, KID_PREFIX_BYTES);
}

/** İstek kodu: sürüm · anahtar özeti (8) · rastgele ek (5) · sağlama (1). Gövde (önek/tiresiz) döner. */
export function buildTempRequestCode(installationKid: string, nonce: Uint8Array): string {
  if (nonce.length !== 5) throw new Error("gecici-kod: ek 5 bayt olmalı");
  const body = new Uint8Array(REQUEST_BYTES);
  body[0] = CODE_VERSION;
  body.set(kidPrefix(installationKid), 1);
  body.set(nonce, 1 + KID_PREFIX_BYTES);
  body[REQUEST_BYTES - 1] = createHash("sha256").update(body.subarray(0, REQUEST_BYTES - 1)).digest()[0];
  return toBase32(body);
}

export const formatTempRequestCode = (body: string): string => group(body, REQUEST_GROUP, TEMP_REQUEST_PREFIX);

/** Portala yazılan istek kodunu çözer: sağlamalı, sürümlü; anahtar özeti hex döner. */
export function parseTempRequestCode(raw: string): TempCodeParse<{ istekKodu: string; anahtarOzeti: string }> {
  const t = normalizeTempText(raw, TEMP_REQUEST_PREFIX);
  const bad = firstInvalidTempChar(t);
  if (bad >= 0) return { ok: false, neden: "KARAKTER", konum: bad };
  if (t.length !== TEMP_REQUEST_LENGTH) return { ok: false, neden: "BICIM" };
  const bytes = fromBase32(t, REQUEST_BYTES);
  if (!bytes) return { ok: false, neden: "BICIM" };
  if (createHash("sha256").update(bytes.subarray(0, REQUEST_BYTES - 1)).digest()[0] !== bytes[REQUEST_BYTES - 1]) return { ok: false, neden: "SAGLAMA" };
  if (bytes[0] !== CODE_VERSION) return { ok: false, neden: "SURUM" };
  return { ok: true, value: { istekKodu: t, anahtarOzeti: Buffer.from(bytes.subarray(1, 1 + KID_PREFIX_BYTES)).toString("hex") } };
}

/** İstek kodu bu anahtarın mı (portal: bağlı anahtarla karşılaştırma). */
export function tempRequestMatchesKid(istekKodu: string, installationKid: string): boolean {
  const p = parseTempRequestCode(istekKodu);
  return p.ok && p.value.anahtarOzeti === Buffer.from(kidPrefix(installationKid)).toString("hex");
}

/** Kök kimliği `kok-<yıl>-<n>` ↔ tek bayt (yıl 2026+0..15 · n 1..16). */
function rootKidByte(kid: string): number | null {
  const m = /^kok-(\d{4})-(\d{1,2})$/.exec(kid);
  if (!m) return null;
  const y = Number(m[1]) - 2026;
  const n = Number(m[2]) - 1;
  return y >= 0 && y < 16 && n >= 0 && n < 16 ? (y << 4) | n : null;
}
const rootKidOf = (b: number): string => `kok-${2026 + (b >> 4)}-${(b & 15) + 1}`;

export const dayOfMs = (ms: number): number => Math.floor((ms - DAY_EPOCH_MS) / DAY_MS);
/** Kodun geçerliliğinin bittiği an: `bitisGunu` gününün SONU (UTC). */
export const tempCodeEndMs = (bitisGunu: number): number => DAY_EPOCH_MS + (bitisGunu + 1) * DAY_MS;

/** JWS imza girdisi (başlık.yük) — satıcı bunu imzalar, fabrika aynısını kurup doğrular. */
export function tempOpeningSigningInput(doc: TempOpeningDoc, rootKid: string): string {
  const header = b64uEncode(JSON.stringify({ alg: JWS_ALG, typ: TYP_GECICI, kid: rootKid }));
  const payload = b64uEncode(JSON.stringify(TempOpeningSchema.parse(doc)));
  return `${header}.${payload}`;
}

/** İmzalı JWS'ten açılış kodu (satıcı). JWS'in yükü `doc` ile bayt-eşit olmalı — değilse programcı hatası. */
export function encodeTempOpeningCode(jws: string, doc: TempOpeningDoc, rootKid: string): string {
  const [h, p, s] = jws.split(".");
  if (`${h}.${p}` !== tempOpeningSigningInput(doc, rootKid)) throw new Error("gecici-kod: JWS yükü beklenen yükle aynı değil");
  const sig = b64uDecode(s ?? "");
  const kb = rootKidByte(rootKid);
  if (!sig || sig.length !== SIG_LENGTH || kb === null) throw new Error("gecici-kod: imza ya da kök kimliği biçimsiz");
  const bytes = new Uint8Array(CODE_BYTES);
  bytes[0] = CODE_VERSION;
  bytes[1] = kb;
  bytes[2] = (doc.kodId >> 16) & 0xff;
  bytes[3] = (doc.kodId >> 8) & 0xff;
  bytes[4] = doc.kodId & 0xff;
  bytes[5] = (doc.bitisGunu >> 8) & 0xff;
  bytes[6] = doc.bitisGunu & 0xff;
  bytes.set(sig, 7);
  const data = toBase32(bytes);
  return data + checkChar(data);
}

export const formatTempOpeningCode = (body: string): string => group(body, TEMP_CODE_GROUP, TEMP_CODE_PREFIX);

/**
 * Fabrika: yazılan kodu çözer ve kendi istek koduyla JWS'i yeniden kurar. İmza burada DOĞRULANMAZ — dönen `jws`
 * çağıranın doğrulayıcısından (çekirdek) geçer.
 */
export function decodeTempOpeningCode(
  raw: string,
  istekKodu: string,
): TempCodeParse<{ doc: TempOpeningDoc; rootKid: string; jws: string; normalized: string }> {
  const t = normalizeTempText(raw, TEMP_CODE_PREFIX);
  const bad = firstInvalidTempChar(t);
  if (bad >= 0) return { ok: false, neden: "KARAKTER", konum: bad };
  if (t.length !== TEMP_CODE_LENGTH) return { ok: false, neden: "BICIM" };
  const data = t.slice(0, -1);
  if (checkChar(data) !== t[t.length - 1]) return { ok: false, neden: "SAGLAMA" };
  const bytes = fromBase32(data, CODE_BYTES);
  if (!bytes) return { ok: false, neden: "BICIM" };
  if (bytes[0] !== CODE_VERSION) return { ok: false, neden: "SURUM" };
  const rootKid = rootKidOf(bytes[1]);
  const doc: TempOpeningDoc = {
    v: CODE_VERSION,
    istekKodu,
    kodId: (bytes[2] << 16) | (bytes[3] << 8) | bytes[4],
    bitisGunu: (bytes[5] << 8) | bytes[6],
  };
  if (!TempOpeningSchema.safeParse(doc).success) return { ok: false, neden: "BICIM" };
  const jws = `${tempOpeningSigningInput(doc, rootKid)}.${b64uEncode(Buffer.from(bytes.subarray(7)))}`;
  return { ok: true, value: { doc, rootKid, jws, normalized: t } };
}

/** Tüketim özeti — fabrika LICENSE_DIR'de, satıcı bildirimde aynı değeri kullanır (düz kod saklanmaz). */
export const tempCodeDigest = (normalized: string): string => createHash("sha256").update(`tekserp-gecici:${normalized}`, "ascii").digest("hex");
