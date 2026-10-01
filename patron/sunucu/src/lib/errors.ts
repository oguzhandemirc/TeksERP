// Bulut hata tipi — gövde backend/satıcı ile aynı: {success:false, message:<TR>, details:{code}}.
// Kod `details.code` altındadır (kök `code` YOK). 503 kullanılmaz (SERVER_BUSY'ye ayrılmış).
import type { ProtocolErrorCode } from "../lisans-protokol";
import { FACTORY_CHANNEL_ERROR_CODES } from "../wire/esitleme";

/**
 * Bulutun HTTP hata kodları. İlk grup satıcının `VENDOR_ERROR_CODES`iyle AYNI anlamı taşır (fabrika
 * iki sunucuya aynı istemci katmanıyla konuşur); protokol doğrulama kodları (`ISTEK_*`, `JWS_*`)
 * olduğu gibi geçer. Fabrika kanalının kodları tel sözleşmesindendir (`wire/esitleme.ts`), ardından yalnız hesap API'sinin
 * kodları gelir. Bekçi `test_patron_kapilari` kodların tekrarsız olduğunu ölçer.
 */
export const CLOUD_ERROR_CODES = [
  ...FACTORY_CHANNEL_ERROR_CODES,
  "OTURUM_YOK",
  "GIRIS_BASARISIZ",
  "YETKISIZ",
  "PAROLA_ZAYIF",
  "EPOSTA_KULLANIMDA",
  "DAVET_GECERSIZ",
  "DAVET_ETKINLESTIRILEMEDI",
  "AKTIF_YONETICI_VAR",
  "IZIN_BILINMIYOR",
  "RAPOR_BULUTTA_YOK",
  "HIZMET_KAPANDI",
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

/**
 * İmzalı istek doğrulanamadı: JWS/İSTEK kodları olduğu gibi, diğerleri genel koda iner. `ISTEK_ZAMAN` bulutun o anki
 * saatini taşır (`details.sunucuSaati`, İMZASIZ): fabrika isteği BİR KEZ düzeltilmiş zamanla yeniden imzalar (D4).
 */
export function requestRejected(code: ProtocolErrorCode, message: string, nowMs: number): CloudError {
  const passThrough = code.startsWith("JWS_") || code.startsWith("ISTEK_");
  const extra = code === "ISTEK_ZAMAN" ? { sunucuSaati: new Date(nowMs).toISOString() } : undefined;
  return new CloudError(401, passThrough ? code : "ISTEK_GECERSIZ", message, extra);
}

export const badRequest = (message: string): CloudError => new CloudError(400, "GOVDE_GECERSIZ", message);
export const notFound = (what: string): CloudError => new CloudError(404, "BULUNAMADI", `${what} bulunamadı`);
export const forbidden = (message = "Bu işlem için yetkiniz yok"): CloudError => new CloudError(403, "YETKISIZ", message);
export const stateConflict = (message: string, extra?: Readonly<Record<string, unknown>>): CloudError =>
  new CloudError(409, "DURUM_CAKISMASI", message, extra);
export const retryConflict = (message = "Eşzamanlı işlem çakıştı; lütfen tekrar deneyin"): CloudError =>
  new CloudError(409, "TEKRAR_DENEYIN", message);
