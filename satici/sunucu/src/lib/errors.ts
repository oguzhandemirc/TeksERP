// Satıcı hata tipi — gövde backend ile aynı: {success:false, message:<TR>, details:{code}}.
import { msToIso, type ProtocolErrorCode, type VendorErrorCode } from "../lisans-protokol";

/**
 * Portal (satıcı + bayi JSON API'si) kodları — protokolün DIŞINDA: fabrika bunları hiç görmez.
 * /v1/* uçları yalnız protokol kodlarını döndürür; bunlar yalnız /portal/api, /bayi/api ve dağıtım uçlarında
 * (/d · /y · /yayin/bildirim — Faz 3d).
 * Ortak kodlar (`BULUNAMADI`, `TEKRAR_DENEYIN`, `GOVDE_GECERSIZ`…) protokolün `VENDOR_ERROR_CODES`inde
 * yaşar; burada TEKRARLANMAZ (tek kaynak — bekçi: test_satici_kapilari §8).
 */
export const PORTAL_ERROR_CODES = [
  "OTURUM_YOK",
  "GIRIS_BASARISIZ",
  "YETKISIZ",
  "DURUM_CAKISMASI",
  "IKINCI_ONAY_GEREKLI",
  "ISLEM_KIMLIGI_CAKISTI",
  "BAYI_TAVANI_ASILDI",
  "URETIM_MODULU_UYARISI",
  "IMZA_PAROLASI_HATALI",
  "IMZA_PAROLASI_KILITLI",
  "PAROLA_ZAYIF",
  "KULLANICI_ADI_KULLANIMDA",
  // Dağıtım (Faz 3d): bağlantı/istek süresi doldu · sayısı bitti · iptal (410); gövde budandı (410);
  // kota (413); dosya tavanı (413); uzantı/MIME allowlist dışı (415); parça/dosya özeti tutmadı (422).
  "BAGLANTI_GECERSIZ",
  "GOVDE_BUDANDI",
  "KOTA_ASILDI",
  "DOSYA_COK_BUYUK",
  "DOSYA_TURU_YASAK",
  "PARCA_BUTUNLUGU",
  "YAYINCI_IMZASI_GECERSIZ",
] as const;
export type PortalErrorCode = (typeof PORTAL_ERROR_CODES)[number];

export type VendorCode = VendorErrorCode | ProtocolErrorCode | PortalErrorCode;

export class VendorError extends Error {
  constructor(
    readonly status: number,
    readonly code: VendorCode,
    message: string,
    readonly extra?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    Object.setPrototypeOf(this, VendorError.prototype);
  }
}

export const vendorError = (status: number, code: VendorCode, message: string): VendorError =>
  new VendorError(status, code, message);

/**
 * İmzalı istek doğrulanamadı: JWS/İSTEK kodları olduğu gibi, diğerleri genel koda iner. `ISTEK_ZAMAN`
 * satıcının o anki saatini taşır (`details.sunucuSaati`, İMZASIZ): fabrika sapmayı ölçüp isteği BİR KEZ
 * düzeltilmiş zamanla yeniden imzalar (D4).
 */
export function requestRejected(code: ProtocolErrorCode, message: string, nowMs: number = Date.now()): VendorError {
  const passThrough = code.startsWith("JWS_") || code.startsWith("ISTEK_");
  return new VendorError(401, passThrough ? code : "ISTEK_GECERSIZ", message, code === "ISTEK_ZAMAN" ? { sunucuSaati: msToIso(nowMs) } : undefined);
}

/** 409 "tekrar deneyin": 40001/40P01 ya da atomik claim kaybı — istemci aynı isteği yeniden dener. */
export const retryConflict = (message = "Eşzamanlı işlem çakıştı; lütfen tekrar deneyin"): VendorError =>
  new VendorError(409, "TEKRAR_DENEYIN", message);

export const notFoundError = (what: string): VendorError => new VendorError(404, "BULUNAMADI", `${what} bulunamadı`);

export const stateConflict = (message: string): VendorError => new VendorError(409, "DURUM_CAKISMASI", message);

export const badRequest = (message: string): VendorError => new VendorError(400, "GOVDE_GECERSIZ", message);
