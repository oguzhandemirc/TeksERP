// Bulut hata tipi — gövde backend/satıcı ile aynı: {success:false, message:<TR>, details:{code}}.
// Kod `details.code` altındadır (kök `code` YOK). 503 kullanılmaz (SERVER_BUSY'ye ayrılmış).
import type { ProtocolErrorCode } from "../lisans-protokol";

/**
 * Bulutun HTTP hata kodları. İlk grup satıcının `VENDOR_ERROR_CODES`iyle AYNI anlamı taşır (fabrika
 * iki sunucuya aynı istemci katmanıyla konuşur); protokol doğrulama kodları (`ISTEK_*`, `JWS_*`)
 * olduğu gibi geçer. Liste tek kaynaktır: bekçi `test_patron_kapilari` kodların tekrarsız olduğunu ölçer.
 */
export const CLOUD_ERROR_CODES = [
  "GOVDE_GECERSIZ",
  "PROTOKOL_SURUMU",
  "ISTEK_GECERSIZ",
  "KURULUM_BILINMIYOR",
  "KURULUM_IPTAL",
  "HIZ_SINIRI",
  "TEKRAR_DENEYIN",
  "BULUNAMADI",
  "SUNUCU_HATASI",
  "SINIF_GONDEREMEZ",
  "PATRON_BULUT_KAPALI",
  "SOZLESME_ESKI",
  "SOZLESME_BILINMIYOR",
  "PAKET_ISLENIYOR",
  "PAKET_BUYUK",
  "PAKET_KIMLIGI_CAKISTI",
  "OTURUM_YOK",
  "GIRIS_BASARISIZ",
  "GIRIS_KILITLI",
  "YETKISIZ",
  "DURUM_CAKISMASI",
  "ISLEM_KIMLIGI_CAKISTI",
  "PAROLA_ZAYIF",
  "EPOSTA_KULLANIMDA",
  "DAVET_GECERSIZ",
  "SON_YONETICI",
  "IZIN_BILINMIYOR",
  "RAPOR_BILINMIYOR",
  "RAPOR_BULUTTA_YOK",
] as const;
export type CloudErrorCode = (typeof CLOUD_ERROR_CODES)[number];

export type CloudCode = CloudErrorCode | ProtocolErrorCode;

export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: CloudCode,
    message: string,
    readonly extra?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    Object.setPrototypeOf(this, CloudError.prototype);
  }
}

/** İmzalı istek doğrulanamadı: JWS/İSTEK kodları olduğu gibi, diğerleri genel koda iner. */
export function requestRejected(code: ProtocolErrorCode, message: string): CloudError {
  const passThrough = code.startsWith("JWS_") || code.startsWith("ISTEK_");
  return new CloudError(401, passThrough ? code : "ISTEK_GECERSIZ", message);
}

export const badRequest = (message: string): CloudError => new CloudError(400, "GOVDE_GECERSIZ", message);
export const notFound = (what: string): CloudError => new CloudError(404, "BULUNAMADI", `${what} bulunamadı`);
export const forbidden = (message = "Bu işlem için yetkiniz yok"): CloudError => new CloudError(403, "YETKISIZ", message);
export const stateConflict = (message: string, extra?: Readonly<Record<string, unknown>>): CloudError =>
  new CloudError(409, "DURUM_CAKISMASI", message, extra);
export const retryConflict = (message = "Eşzamanlı işlem çakıştı; lütfen tekrar deneyin"): CloudError =>
  new CloudError(409, "TEKRAR_DENEYIN", message);
