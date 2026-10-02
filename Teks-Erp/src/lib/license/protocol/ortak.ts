// Lisans protokolünün ortak ilkelleri: sonuç tipi, sabit hata kodları, base64url, zaman.
// Bu klasör KENDİ İÇİNE KAPALIDIR — yalnız `node:crypto`, `zod` ve kardeş dosyalar;
// satıcı ve patron sunucusu klasörü bayt-eşit ayna olarak taşır.

/** Doğrulama sonuçları istisna değil değerdir: çağıran her dalı adıyla ele alır. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ProtocolErrorCode; readonly message: string };

export const PROTOCOL_ERROR_CODES = [
  "JWS_BICIM",
  "JWS_BASLIK",
  "JWS_ALG",
  "JWS_TYP",
  "JWS_KID",
  "JWS_IMZA",
  "BELGE_SEMA",
  "BELGE_SURUM",
  "BELGE_SURESI_DOLDU",
  "BELGE_ILERI_TARIHLI",
  "GUVEN_CAPASI_BOS",
  "GUVEN_CAPASI_BICIM",
  "KOK_BILINMIYOR",
  "KOK_SINIF_YETKISIZ",
  "SERTIFIKA_KULLANIM",
  "SERTIFIKA_ZAMAN",
  "SERTIFIKA_IPTAL",
  "BAYI_KIMLIK",
  "BAYI_TAVAN_MODUL",
  "BAYI_TAVAN_SINIF",
  "IMZACI_KIMLIK",
  "UFUK_TAVANI_ASIMI",
  "KIRA_HAK_UYUSMAZ",
  "KIRA_SINIF_YETKISIZ",
  "INDIRME_OMUR",
  "INDIRME_YOL",
  "INDIRME_PENCERE",
  "INDIRME_KANAL",
  "ISTEK_KID",
  "ISTEK_AMAC",
  "ISTEK_YOL",
  "ISTEK_ZAMAN",
  "ISTEK_KURULUM",
  "ISTEK_GOVDE_OZETI",
  "ISTEK_TEKRAR",
  "ZARF_BICIM",
  /** Sürüm işaretçisi (`son.json` / `<sürüm>/surum.json`) çözülemedi. */
  "SURUM_ISARETCI",
  /** Sürüm bildirimi başka bir kanalın — kanallar arası tekrar oynatma. */
  "SURUM_KANAL",
  /** Bildirimi imzalayan PAKET anahtarı bildirimin beyan ettiği `paketImzaKid` değil. */
  "SURUM_ANAHTAR",
  /** Açılan paketin imzalı künyesi (`butunluk.jws`) bildirimle bağlanmıyor. */
  "PAKET_BAGI",
  /** PG paketi künyesi backend bildiriminin PG hedefiyle bağlanmıyor (farklı ana sürüm dahil). */
  "PG_BAGI",
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure<T>(code: ProtocolErrorCode, message: string): Result<T> {
  return { ok: false, code, message };
}

/** Başarısız bir sonucu başka bir değer tipine taşır (kod ve mesaj aynen kalır). */
export function forwardFailure<T>(failed: { readonly code: ProtocolErrorCode; readonly message: string }): Result<T> {
  return { ok: false, code: failed.code, message: failed.message };
}

/** Saat farkı toleransı — belge zamanları ve istek damgası bu kadar esner. */
export const CLOCK_SKEW_MS = 10 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const B64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

export function b64uEncode(data: Uint8Array | string): string {
  return Buffer.from(data).toString("base64url");
}

/**
 * Katı base64url çözümü: dolgu, yabancı karakter ve kanonik olmayan kuyruk bitleri
 * RED — `Buffer.from(…, "base64url")` bunları sessizce yutar ve aynı imzanın iki
 * yazımını mümkün kılardı.
 */
export function b64uDecode(text: string): Buffer | null {
  if (!B64URL_PATTERN.test(text) || text.length % 4 === 1) return null;
  const data = Buffer.from(text, "base64url");
  return data.toString("base64url") === text ? data : null;
}

/** ISO-8601 UTC damgasını epoch ms'ye çevirir; şema zaten biçimi denetlemiştir. */
export function isoToMs(iso: string): number {
  return Date.parse(iso);
}

export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Düz nesne mi (dizi ve null değil)? JSON'dan gelen başlık/yük için. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
