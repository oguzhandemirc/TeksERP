// ETKİLİ DESTEK — hesap API'sinin destek uçlarında dönebilecek `details.code` değerleri (CLOUD_ERROR_CODES'a eklenir).
// Fabrika sözleşmesiyle (`docs/ops/DESTEK-ENTEGRASYONU.md` §4) AYNI adlar: patron uygulaması ile panel aynı kararı verir.
// Merkezin 4xx kodları olduğu gibi geçer (yalnız bu listedekiler; bilinmeyen 4xx `DESTEK_HATASI` + `merkezKodu`).

/** Merkezin kılavuzdaki 4xx kodları (kılavuz §5) — aynen istemciye taşınır. */
export const DESTEK_CENTER_CODES = [
  "VALIDATION_FAILED",
  "MESSAGE_EMPTY",
  "SUBJECT_EMPTY",
  "MESSAGE_TOO_LONG",
  "TICKET_TYPE_INVALID",
  "IDENTITY_INVALID",
  "CONTEXT_INVALID",
  "CONTEXT_TOO_LARGE",
  "ATTACHMENT_INVALID",
  "ATTACHMENT_TOO_LARGE",
  "TOO_MANY_ATTACHMENTS",
  "FORBIDDEN",
  "NOT_FOUND",
  "ATTACHMENT_EXPIRED",
  "REOPEN_WINDOW_EXPIRED",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
] as const;

export const DESTEK_ERROR_CODES = [
  ...DESTEK_CENTER_CODES,
  /** Özellik kapalı (API anahtarı yok): 403 + `modul: "destek"`. */
  "MODULE_DISABLED",
  /** Merkez 5xx / ağ hatası / REPLAYED → 502. */
  "DESTEK_ULASILAMADI",
  /** Merkez zaman aşımı → 504. */
  "DESTEK_ZAMAN_ASIMI",
  /** Merkez anahtarı/imzayı reddetti (401, INSTALLATION_INACTIVE) → 502 (bilerek 401 değil: oturum kapanmasın). */
  "DESTEK_YAPILANDIRMA",
  /** Merkezin tanımadığımız 4xx kodu (`merkezKodu` ayrıntıda). */
  "DESTEK_HATASI",
  /** Webhook doğrulaması (yalnız `/api/destek/webhook`). */
  "INVALID_SIGNATURE",
  "TIMESTAMP_OUT_OF_RANGE",
  "INVALID_PAYLOAD",
] as const;

export type DestekErrorCode = (typeof DESTEK_ERROR_CODES)[number];
export type DestekCenterCode = (typeof DESTEK_CENTER_CODES)[number];

export function isCenterCode(code: string): code is DestekCenterCode {
  return (DESTEK_CENTER_CODES as readonly string[]).includes(code);
}
