// =============================================================================
// Patron telefon uygulaması — ERP'ye doğrudan bağlanan istemcinin sabitleri (V1, 2026-11-13)
// =============================================================================
// Uygulama bulut kopyası yerine gerçek ERP API'siyle konuşur (VDS kurulumunda doğrudan HTTPS).
// Plan: ~/.tekserp/plan/PLAN-tek-api-tunel-1113.md §6 (sürüm uyumu) ve §10 T4.
// =============================================================================

/**
 * Patron API sözleşme sürümü — uygulama `/api/auth/me` `patronApiVersion`dan okur ve tanımadığı
 * yeteneği gizler. Backend yalnız EKLER; alan/uç kaldırılırsa (gerçek kırılma) bu sayı artar.
 */
export const PATRON_API_VERSION = 1;

/**
 * V5a: `/api/patron/v1/raporlar` (istek üzerine oluştur + geçmiş) sözleşme sürümü — `/auth/me` `patronReportApi`.
 * Alan yoksa (eski backend) uygulama ERP kipinde rapor sekmesini gizler. Ekleme olduğu için `PATRON_API_VERSION` artmaz.
 */
export const PATRON_REPORT_API_VERSION = 1;

/**
 * Patron oturumunun mutlak ömrü (gün) — kullanıcı kararı "30 günde bir parola" (2026-11-13). Yenileme
 * belirteci YOK; süre bitince parola (+ kullanıcı açtıysa kod) yeniden istenir. Fabrikanın mutlak tavanı
 * (`auth.absoluteSessionCapDays`) daha kısaysa o kazanır.
 */
export const PATRON_SESSION_DAYS = 30;
