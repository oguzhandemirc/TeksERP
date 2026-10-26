// =============================================================================
// Belge tasarım yüzeyinin izin kümeleri (backend AYNASI)
// =============================================================================
// Tanımlar → Çıktılar altındaki dört ekran — Belge Şablonları · Refakat Kartı ·
// Refakat Kartı Şablonları · Serbest Belgeler — 2026-08-05'e kadar düz
// `admin:settings` ile korunuyordu. Artık kendi izin çifti var:
// `document-template:read` / `document-template:write`.
//
// ⚠️ `admin:settings` HER İKİ KÜMEDE DE var ve öyle KALMALI. Sıkı ayrım
// yapılsaydı deploy anında admin dahil hiç kimse bu ekranları açamazdı: boot
// uzlaştırması yeni izin satırını DB'ye getirir ama kimseye ATAMAZ.
//
// ⚠️ READ kümesi `document-template:write`i de içerir — yazabilen okuyabilir.
// Panelden yalnız "düzenleme" kutusunu işaretleyen admin, aksi halde ekranı
// hiç AÇAMAYAN bir kullanıcı üretirdi.
//
// ⚠️ Bu dosya backend `Teks-Erp/src/constants/document-design.ts`'in AYNASIDIR.
// Electron backend'i import edemez (mobil `types/permissions.ts` ile aynı
// durum) — birini değiştirirken diğerini de değiştir. Backend bekçisi
// `scripts/test_document_template_permission.ts` iki listenin birebirliğini
// mekanik olarak doğrular.
// =============================================================================

/** Belge tasarım ekranlarını AÇMAK için yeterli izinler (herhangi biri). */
export const DOCUMENT_DESIGN_READ = [
  "admin:settings",
  "document-template:read",
  "document-template:write",
  "document-template:design",
  "document-template:publish",
];

/** Belge tasarımını DEĞİŞTİRMEK için yeterli izinler (herhangi biri). */
export const DOCUMENT_DESIGN_WRITE = ["admin:settings", "document-template:write"];

/** Belge tasarımcısı: tasarla / yayınla (backend constants/document-design.ts aynası). */
export const DOCUMENT_TEMPLATE_DESIGN = ["admin:settings", "document-template:design"];
export const DOCUMENT_TEMPLATE_PUBLISH = ["admin:settings", "document-template:publish"];

// =============================================================================
// Ekran başına ayar / sistem izinleri (2026-09-24)
// =============================================================================
// Her küme bir EKRANIN kapısıdır: `admin:settings` (şemsiye) + o ekranın dar
// izinleri. Kümeler saf string literal dizi kalır — backend `test_screen_catalog`
// route kapısını bu dosyadan METİN olarak çözer. Kategori ↔ küme hizası
// `settings-surface.test.ts`, anahtar ↔ izin tablosu backend
// `constants/settings-scopes.ts` (`test_settings_scopes`).
// =============================================================================

/** Özellik Anahtarları — sekmelerden birini açabilen ekrana girer. */
export const SETTINGS_FLAGS_ACCESS = [
  "admin:settings",
  "settings:customers",
  "settings:orders",
  "settings:shipping",
  "settings:work-orders",
  "settings:production",
  "settings:kartela",
  "settings:devere",
  "settings:dokuma",
  "settings:warehouse",
  "settings:yarn",
  "settings:finance",
];

/** Baskı & Cihazlar — Etiket Baskısı · Cihazlar. */
export const SETTINGS_PRINTING_ACCESS = ["admin:settings", "settings:label", "settings:devices"];

/** Bu Bilgisayar — yazıcı · kantar · tabanca · sunucu adresi (yerel). */
export const SETTINGS_WORKSTATION_ACCESS = ["admin:settings", "settings:workstation"];

/** Şirket & Güvenlik — Şirket Bilgileri · e-İrsaliye · Oturum & Güvenlik. */
export const SETTINGS_COMPANY_ACCESS = ["admin:settings", "settings:company", "settings:e-irsaliye", "settings:session"];

export const SYSTEM_ACTIVITY_ACCESS = ["admin:settings", "system:activity"];
export const SYSTEM_WORK_SESSIONS_ACCESS = ["admin:settings", "system:work-sessions"];
export const SYSTEM_SERVER_STATUS_ACCESS = ["admin:settings", "system:server-status"];
export const SYSTEM_CLIENTS_ACCESS = ["admin:settings", "system:clients"];
export const SYSTEM_BACKUPS_ACCESS = ["admin:settings", "system:backups"];
/** Yazdırma geçmişi — backend `PRINT_HISTORY_READ` ve `screen-catalog` `system/print-history` ile aynı küme. */
export const SYSTEM_PRINT_HISTORY_ACCESS = ["admin:settings", "system:print-history"];
export const SYSTEM_ROLL_ARCHIVE_ACCESS = ["admin:settings", "roll:read"];
/**
 * Lisans ekranı — backend `SCREEN_CATALOG` `system/license` aynası; `admin:settings`
 * BİLEREK yok (lisans ayrı atanır; manifestoda beyanlı değil).
 */
export const LICENSE_ACCESS = ["license:view", "license:manage"];

/**
 * Kalite Güvence kökü (UX-2 K1) — karolarından BİRİNİ açabilen herkes (route + yan menü aynı küme).
 * Saf dizge listesi: `test_screen_catalog` sabit referansı metinden çözer (yayılım yazılmaz).
 */
export const QUALITY_HUB_ACCESS = ["inspection:read", "labtest:read", "certificate:read"];

/**
 * Belgeler kökü (UX-2 K2) — Etiketler (`station:read`|`label-template:read`) + belge tasarım ekranları
 * (`DOCUMENT_DESIGN_READ`) birleşimi; karolar kendi izniyle süzülür. Saf dizge listesi (yayılım yazılmaz).
 */
export const DOCUMENTS_HUB_ACCESS = [
  "station:read",
  "label-template:read",
  "admin:settings",
  "document-template:read",
  "document-template:write",
  "document-template:design",
  "document-template:publish",
];

/**
 * Sistem hub'ı (ve kenar çubuğundaki "Sistem") — karolarından BİRİNİ açabilen
 * herkes. `roll:read` BİLEREK yok: Top Arşivi'ni hub'a giren görür, ama her
 * operatörün menüsüne "Sistem" koymak için yeterli sebep değildir.
 */
export const SYSTEM_HUB_ACCESS = [
  "admin:settings",
  "data:import",
  "master-data:merge",
  "settings:numbering",
  "settings:workstation",
  "settings:customers",
  "settings:orders",
  "settings:shipping",
  "settings:work-orders",
  "settings:production",
  "settings:kartela",
  "settings:devere",
  "settings:dokuma",
  "settings:warehouse",
  "settings:yarn",
  "settings:finance",
  "settings:label",
  "settings:devices",
  "settings:company",
  "settings:e-irsaliye",
  "settings:session",
  "system:activity",
  "system:work-sessions",
  "system:server-status",
  "system:clients",
  "system:backups",
  "system:print-history",
  "license:view",
  "license:manage",
  "settings:notifications", // bildirim: Bildirim profilleri karosu
];

// e-İrsaliye (E5 `permission-catalog` LOGISTICS aynası). Okuma kartı/listeyi, yazma
// hazırla→üret→işaretle akışını, geri alma (SoD ruhu) yalnız gönderim/yanıt kaydını açar.
export const EIRSALIYE_READ = "eirsaliye:read";
export const EIRSALIYE_WRITE = "eirsaliye:write";
export const EIRSALIYE_UNDO = "eirsaliye:undo";
/** `GET /api/e-irsaliye/readiness` guard'ı — ayar sekmesindeki rozet de okur. */
export const EIRSALIYE_READINESS_ACCESS = [EIRSALIYE_READ, "settings:e-irsaliye", "admin:settings"];

// bildirim: Ayarlar → Bildirim profilleri (yönetici; backend `SCREEN_CATALOG` `system/notification-profiles` aynası).
export const NOTIFICATION_PROFILES_ACCESS = ["admin:settings", "settings:notifications"];
