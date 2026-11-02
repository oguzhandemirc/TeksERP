// =============================================================================
// DOĞRULAMA KİPİ (Dağıtım v2 — docs/design/GUNCELLEYICI.md §4.3 · §8.6)
// =============================================================================
// Güncelleyici yeni sürümü göçten sonra önce `--dogrulama` ile başlatır; konak ortama `HOST=127.0.0.1` +
// `TEKSERP_DOGRULAMA_KIPI=1` ekler. Bu kipte backend yalnız "sağlıklı açılıyor mu" sorusunu cevaplar: istemci
// yazısı gelmez (yalnız döngü adresi) ve zamanlayıcıyla tekrarlayan ya da DIŞARI konuşan hiçbir iş başlamaz —
// sağlık düşerse DB güncelleme öncesi yedekten geri yüklenebilsin, satıcıya/buluta/yedek hedefine yarım bir
// sürümün izi gitmesin. Tek seferlik, idempotent açılış uzlaştırmaları KOŞAR: doğrulama tam da onları ölçer.
// Kapsam iki listede beyanlı; bekçi `test_dogrulama_kipi` `server.ts`teki her `start*` çağrısını ölçer.
// =============================================================================

export const VERIFICATION_MODE_ENV = "TEKSERP_DOGRULAMA_KIPI";

/** Konak yalnız "1" yazar; başka her değer (boş, "0", "true") kip DEĞİLDİR — normal açılış bugünkü gibi. */
export function isVerificationMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[VERIFICATION_MODE_ENV] === "1";
}

/**
 * Yardımcı test sunucusu kipi (CI HTTP bekçi sunucuları, `scripts/bekci-http.ts`): `SKIPPED` listesindeki işler
 * başlamaz, başka hiçbir şey değişmez (HOST/TLS/lisans motoru normal). Gerekçe: test DB'ye paylaşılan bu sunucuların
 * kur turu gerçek TCMB kurunu yazıp "kur yok" varsayan bekçileri sıraya bağlı kırıyordu (arşiv 2026-11-02).
 */
export const SCHEDULED_JOBS_OFF_ENV = "TEKSERP_ZAMANLAYICI_KAPALI";

/** Yalnız "1" kapatır; bayrak yoksa (üretim) işler bugünkü gibi başlar. */
export function isScheduledJobsOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SCHEDULED_JOBS_OFF_ENV] === "1";
}

/** Doğrulama kipinde BAŞLAMAYAN açılış işleri (zamanlayıcı ya da dış bağlantı) — `server.ts`teki çağrı adı. */
export const VERIFICATION_SKIPPED_JOBS = [
  "startMaintenanceScheduler", // gece bakımı: audit arşivi + budama + yedek rotasyonu (zamanlayıcı, DB/dosya yazar)
  "startBackupScheduler", // gece yedeği (zamanlayıcı)
  "startOffsiteSweeper", // makine dışı yedek kopyası (dışarı)
  "startMdnsAdvertiser", // servis ilanı (istemci bu sürümü bulmasın)
  "startExchangeRateScheduler", // TCMB kuru (dışarı + DB yazar)
  "startShiftCalendarScheduler", // vardiya takvimi (zamanlayıcı, DB yazar)
  "startShiftCloseScheduler", // vardiya karnesi (zamanlayıcı, DB yazar)
  "startLoomAlarmScheduler", // dokuma alarm motoru (zamanlayıcı, DB yazar)
  "startMachineWatchdogScheduler", // kart watchdog'u D4 (zamanlayıcı, DB yazar: sessizlik + geçici kapanış)
  "startPendingDeviceExpiryScheduler", // bekleyen cihaz süre aşımı O3 (zamanlayıcı, DB yazar; barındırılanda)
  "startLicenseDoorbell", // satıcı kapı zili (dışarı)
  "startPatronCloudJobs", // patron bulutu eşitlemesi + gelen kutusu (dışarı + DB yazar)
  "startErrorReportJob", // hata raporu kuyruğu + gönderim (dışarı + DB yazar)
  "startDocumentReader", // gelen belge okuma işi: sidecar'a istek (dışarı) + taslak yazar (DB)
  "startNotificationJobs", // bildirim dağıtıcısı + koşul tarayıcısı (bayrak açıkken DB yazar)
] as const;

/**
 * Doğrulama kipinde de KOŞAN açılış işleri: tek seferlik, idempotent uzlaştırmalar. Lisans motoru yalnız YEREL
 * ölçümü koşar (kimlik → DB olguları → parmak izi → bütünlük), yoklamaz ve lisans durumunu yalnız OKUR: durum kaydı,
 * DB izi, iptal kopyası onarımı, parmak izi önbelleği açılışta da kapanışta da yazılmaz (`test_lisans_motoru` §34).
 */
export const VERIFICATION_KEPT_JOBS = [
  "startPermissionCatalogReconciler",
  "startInstallationIdentity",
  "startSuperadminAccount",
  // Kısa kimlik anahtar halkası + emanet: tek seferlik, yerel (dışarı çıkmaz); yeni sürüm PIN/kart doğrulayabiliyor mu ölçer.
  "startShortCredentialJob",
  "startModuleProfileJob",
  "startDefaultWarehouseReconciler",
  "startLicensePoll",
] as const;
