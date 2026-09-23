// =============================================================================
// SİSTEM OLAYI ADLARI — BEYAN EDİLMİŞ SÖZLEŞME (türetilmiş envanter DEĞİL)
// =============================================================================
// `AuditService.logEvent({ action })` yalnız buradaki adlardan birini yazabilir.
//
// ⚠️ NEDEN BEYAN, NEDEN TÜRETME: küme ölçülerek bulunamıyor (ölçüldü 2026-09-12).
// Kaynakta dizge arayan tarama, adı SABİTTEN kurulan çağrıları göremez (6 ad) ve
// yalnız `src/` tararsa betiklerden yazılan adları da göremez (7 onarım izi);
// DB'den `DISTINCT action` okumak ise yalnız KOŞMUŞ yolları görür. İkisinin
// BİRLEŞİMİ bile gerçek kümeyi vermedi. Ölçülebilen bir gerçeklik yoksa beyan
// edilmiş bir sözleşme kurulur; kapı sonra UYUMU ölçer.
//
// ⚠️ "DB'de yok" BİR BULGU DEĞİLDİR ve oran şaşırtıcı: ÖLÇÜLDÜ 2026-09-13 —
// fabrikanın canlı yedeği 16, demo veritabanı 12 farklı ad yazmış, BİRLEŞİM 18 ⇒
// aşağıdaki 52 adın **34'ü hiç yazılmamış** ve hepsi meşru kod yolu
// (`AUDIT_ARCHIVE` 6 ayda bir · `UNCAUGHT_EXCEPTION` felaket yolu · `DB_COPY_*`
// elle tetiklenen tur · `SETTINGS_PASSWORD_*` fabrika kapıyı hiç kurmadı).
// Ters yön de ölçüldü: DB'de olup sözleşmede OLMAYAN ad **0**. Temizlemeye kalkma.
//
// ⚠️ ARŞİV: yazan kodu kalmamış ad SİLİNMEZ. Bir olay adı bir kez yazıldıysa adı
// sonsuza kadar OKUNABİLİR kalmalıdır — yazan kodun ölmesi, yazılmış satırın ölmesi
// değildir (defter doktrininin etiket tarafı). Böyle adlar `ARCHIVED_EVENTS`e girer:
// kapı onları "çağrı yeri yok" diye kırmızıya çevirmez, Türkçe etiketleri ZORUNLU kalır.
//
// Ayna: `Electron/src/lib/audit-labels.ts` → `EVENT_ACTION_LABELS` (kapı iki yönlü ölçer).
// =============================================================================

/** Kimlik doğrulama olayları. */
const AUTH_EVENTS = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  /** Ardışık başarısız deneme eşiği aşıldı. */
  LOGIN_LOCKED: "LOGIN_LOCKED",
  /** Açık oturum varken giriş engellendi. */
  LOGIN_CONFLICT: "LOGIN_CONFLICT",
  LOGOUT: "LOGOUT",
} as const;

/** Süreç ve çalışma zamanı. */
const RUNTIME_EVENTS = {
  STARTUP: "STARTUP",
  ERROR: "ERROR",
  UNHANDLED_REJECTION: "UNHANDLED_REJECTION",
  UNCAUGHT_EXCEPTION: "UNCAUGHT_EXCEPTION",
  /** 6 ayda bir koşan arşivleme işi — "DB'de yok" normaldir. */
  AUDIT_ARCHIVE: "AUDIT_ARCHIVE",
  /** Bir kullanıcının hızlı PIN'i / kart kodu OKUNDU — güvenlik olayı. */
  USER_CREDENTIAL_READ: "USER_CREDENTIAL_READ",
  PERIPHERAL_TEST: "PERIPHERAL_TEST",
} as const;

/** Yedekleme ve dış kopya. */
const BACKUP_EVENTS = {
  BACKUP_TRIGGER: "BACKUP_TRIGGER",
  BACKUP_COMPLETED: "BACKUP_COMPLETED",
  BACKUP_FAILED: "BACKUP_FAILED",
  BACKUP_DOWNLOAD: "BACKUP_DOWNLOAD",
  BACKUP_RESTORE_PREVIEW: "BACKUP_RESTORE_PREVIEW",
  OFFSITE_REMOTE_AUTHORIZED: "OFFSITE_REMOTE_AUTHORIZED",
} as const;

/** Kopyaya geri yükleme turu (elle tetiklenir — DB'de olmaması normal). */
const DB_COPY_EVENTS = {
  DB_COPY_STARTED: "DB_COPY_STARTED",
  DB_COPY_VERIFIED: "DB_COPY_VERIFIED",
  DB_COPY_COMPLETED: "DB_COPY_COMPLETED",
  DB_COPY_FAILED: "DB_COPY_FAILED",
  DB_COPY_DROPPED: "DB_COPY_DROPPED",
  DB_SWAP_COMMAND_ISSUED: "DB_SWAP_COMMAND_ISSUED",
} as const;

/** İçe aktarım ve katalog uzlaştırması. */
const IMPORT_EVENTS = {
  IMPORT_RUN: "IMPORT_RUN",
  /** Koşumun yazdığı satırların ters kaydı (koşum silinmez, damgalanır). */
  IMPORT_REVERT: "IMPORT_REVERT",
  CONFIG_BUNDLE_IMPORT: "CONFIG_BUNDLE_IMPORT",
  PERMISSION_CATALOG_RECONCILED: "PERMISSION_CATALOG_RECONCILED",
  PERMISSION_CATALOG_RECONCILE_FAILED: "PERMISSION_CATALOG_RECONCILE_FAILED",
  ROLE_TEMPLATE_CATALOG_RECONCILED: "ROLE_TEMPLATE_CATALOG_RECONCILED",
  /** Boot uzlaştırması katalogda olup DB'de olmayan numara serilerini doğurdu. */
  NUMBER_SERIES_SEEDED: "NUMBER_SERIES_SEEDED",
  /**
   * Eski `workorder.partyCodeAuto` bayrağı `numberSource`a TEK SEFERLİK göç etti.
   * Damgalıdır: bir daha koşmaz, yani bu olay kurulum başına EN ÇOK BİR KEZ görünür.
   */
  NUMBER_SOURCE_MIGRATED: "NUMBER_SOURCE_MIGRATED",
  /** Biçim kolonları `number_series_lines` tablosuna TEK SEFERLİK taşındı. */
  NUMBER_SERIES_LINES_MIGRATED: "NUMBER_SERIES_LINES_MIGRATED",
} as const;

/** Süperadmin, sistem hesabı, modül profili. */
const ADMIN_EVENTS = {
  SUPERADMIN_PROVISIONED: "SUPERADMIN_PROVISIONED",
  SUPERADMIN_ROTATED: "SUPERADMIN_ROTATED",
  SUPERADMIN_ABSENT_MODULE_WRITE: "SUPERADMIN_ABSENT_MODULE_WRITE",
  SYSTEM_ACCOUNT_WRITE_BLOCKED: "SYSTEM_ACCOUNT_WRITE_BLOCKED",
  MODULE_PROFILE_APPLIED: "MODULE_PROFILE_APPLIED",
} as const;

/** Kurulum kimliği (servis keşfi). */
const DISCOVERY_EVENTS = {
  INSTALLATION_ID_CREATED: "INSTALLATION_ID_CREATED",
  /** Görülmesi NORMAL DEĞİL: kimlik yenilenince sahadaki her cihaz uyarı alır. */
  INSTALLATION_ID_REGENERATED: "INSTALLATION_ID_REGENERATED",
} as const;

/**
 * Ayar şifresi olayları.
 * ⚠️ BU AİLE KAPININ KÖR NOKTASIYDI: çağrı yerleri adı SABİTTEN kuruyor
 * (`action: SETTINGS_PASSWORD_EVENTS.FAILED`), bu yüzden kaynakta dizge arayan
 * tarama onları hiç görmedi ve altı olayın Türkçesi aylarca eksik kaldı (ekran ham
 * `SETTINGS_PASSWORD_FAILED` basıyordu). Sabit artık BU BİRLİKTEN türetiliyor
 * (`settings-password.service.ts` içinde `satisfies`), yani kaçak yeniden doğamaz.
 */
const SETTINGS_PASSWORD_EVENT_NAMES = {
  SETTINGS_PASSWORD_SET: "SETTINGS_PASSWORD_SET",
  SETTINGS_PASSWORD_ROTATED: "SETTINGS_PASSWORD_ROTATED",
  SETTINGS_PASSWORD_REVOKED: "SETTINGS_PASSWORD_REVOKED",
  SETTINGS_PASSWORD_USED: "SETTINGS_PASSWORD_USED",
  SETTINGS_PASSWORD_FAILED: "SETTINGS_PASSWORD_FAILED",
  SETTINGS_PASSWORD_LOCKED: "SETTINGS_PASSWORD_LOCKED",
} as const;

/**
 * ONARIM / BACKFILL İZLERİ — `scripts/*.ts` `--apply` koşumlarının bıraktığı iz.
 * ⚠️ BU GRUP BİRLİK SAYESİNDE BULUNDU: ilk hasadım yalnız `src/` tarıyordu (bekçi
 * dosyalarındaki ad listelerini çağrı yeri saymamak için) ve bu yedi adı GÖRMEDİ;
 * `typecheck:scripts` onları ilk koşumda yakaladı. Hiçbirinin Türkçesi yoktu, yani
 * üretimde koşacak onarım script'lerinin izi Sistem Kayıtları'nda ham kod olarak
 * görünecekti. Çoğu `lib/onarim-izi.ts` üzerinden yazılır (o dosya da artık
 * `SystemEventName` istiyor), `ROLL_WAREHOUSE_BACKFILL` doğrudan `logEvent` çağırır.
 */
const REPAIR_EVENTS = {
  DENETIM_ONARIM: "DENETIM_ONARIM",
  MASTER_DATA_NAME_NORMALIZE: "MASTER_DATA_NAME_NORMALIZE",
  ROLL_FOLD_AND_REASON_BACKFILL: "ROLL_FOLD_AND_REASON_BACKFILL",
  ROLL_LABEL_CUSTOMER_BACKFILL: "ROLL_LABEL_CUSTOMER_BACKFILL",
  ROLL_PRODUCTION_TIMESTAMPS_BACKFILL: "ROLL_PRODUCTION_TIMESTAMPS_BACKFILL",
  ROLL_WAREHOUSE_BACKFILL: "ROLL_WAREHOUSE_BACKFILL",
  TAMBUR_UNDO_CANCEL_MARKER_BACKFILL: "TAMBUR_UNDO_CANCEL_MARKER_BACKFILL",
  /** Kasa defteri geçmiş doldurma (tek yazar dilimi, 2026-09-18) — `scripts/migrate_cash_ledger_backfill.ts`. */
  CASH_LEDGER_PAYMENT_BACKFILL: "CASH_LEDGER_PAYMENT_BACKFILL",
} as const;

/**
 * ARŞİV — yazan kodu KALMAMIŞ ama yazılmış satırları DB'de duran adlar.
 * Kapı bunlar için "çağrı yeri yok" diye kırmızı vermez; Türkçe etiketleri ZORUNLU.
 * ⚠️ Buraya ad eklemek bir KARARDIR: yazan kodun kaldırıldığı ÖLÇÜLDÜKTEN sonra
 * taşınır (ölçüm 2026-09-12: ikisi de `Teks-Erp/src`te 0 eşleşme).
 */
export const ARCHIVED_EVENTS = {
  SUPERADMIN_ACCOUNT_CREATED: "SUPERADMIN_ACCOUNT_CREATED",
  SYSTEM_ACCOUNT_ACCESS_BLOCKED: "SYSTEM_ACCOUNT_ACCESS_BLOCKED",
} as const;

/** Yazılabilir olay adları (arşiv HARİÇ — arşive yeni satır yazılamaz). */
export const SYSTEM_EVENT = {
  ...AUTH_EVENTS,
  ...RUNTIME_EVENTS,
  ...BACKUP_EVENTS,
  ...DB_COPY_EVENTS,
  ...IMPORT_EVENTS,
  ...ADMIN_EVENTS,
  ...DISCOVERY_EVENTS,
  ...SETTINGS_PASSWORD_EVENT_NAMES,
  ...REPAIR_EVENTS,
} as const;

/** `logEvent({ action })` imzasının tipi — yalnız yazılabilir adlar. */
export type SystemEventName = (typeof SYSTEM_EVENT)[keyof typeof SYSTEM_EVENT];

/** Arşiv adları; okunur, yazılmaz. */
export type ArchivedSystemEventName = (typeof ARCHIVED_EVENTS)[keyof typeof ARCHIVED_EVENTS];

/** Etiket aynasının kapsaması gereken küme: yazılabilir + arşiv. */
export const ALL_EVENT_NAMES: readonly string[] = [
  ...Object.values(SYSTEM_EVENT),
  ...Object.values(ARCHIVED_EVENTS),
];
