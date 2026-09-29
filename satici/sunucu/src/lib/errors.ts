// Satıcı hata tipi — gövde backend ile aynı: {success:false, message:<TR>, details:{code}}.
import type { ProtocolErrorCode, VendorErrorCode } from "../lisans-protokol";

/**
 * Portal (satıcı + bayi JSON API'si) kodları — protokolün DIŞINDA: fabrika bunları hiç görmez.
 * /v1/* uçları yalnız protokol kodlarını döndürür; bunlar yalnız /portal/api ve /bayi/api'de.
 */
export const PORTAL_ERROR_CODES = [
  "BULUNAMADI",
  "OTURUM_YOK",
  "GIRIS_BASARISIZ",
  "GIRIS_KILITLI",
  "YETKISIZ",
  "DURUM_CAKISMASI",
  "IKINCI_ONAY_GEREKLI",
  "ISLEM_KIMLIGI_CAKISTI",
  "BAYI_TAVANI_ASILDI",
  "URETIM_MODULU_UYARISI",
  "IMZA_PAROLASI_HATALI",
  "PAROLA_ZAYIF",
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

/** İmzalı istek doğrulanamadı: JWS/İSTEK kodları olduğu gibi, diğerleri genel koda iner. */
export function requestRejected(code: ProtocolErrorCode, message: string): VendorError {
  const passThrough = code.startsWith("JWS_") || code.startsWith("ISTEK_");
  return new VendorError(401, passThrough ? code : "ISTEK_GECERSIZ", message);
}

export const retryConflict = (): VendorError =>
  new VendorError(409, "SUNUCU_HATASI", "Eşzamanlı işlem çakıştı; lütfen tekrar deneyin");

export const notFoundError = (what: string): VendorError => new VendorError(404, "BULUNAMADI", `${what} bulunamadı`);

export const stateConflict = (message: string): VendorError => new VendorError(409, "DURUM_CAKISMASI", message);

export const badRequest = (message: string): VendorError => new VendorError(400, "GOVDE_GECERSIZ", message);
