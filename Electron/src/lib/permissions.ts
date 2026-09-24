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
];

/** Belge tasarımını DEĞİŞTİRMEK için yeterli izinler (herhangi biri). */
export const DOCUMENT_DESIGN_WRITE = ["admin:settings", "document-template:write"];

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

/** Şirket & Güvenlik — Şirket Bilgileri · Oturum & Güvenlik. */
export const SETTINGS_COMPANY_ACCESS = ["admin:settings", "settings:company", "settings:session"];

export const SYSTEM_ACTIVITY_ACCESS = ["admin:settings", "system:activity"];
export const SYSTEM_WORK_SESSIONS_ACCESS = ["admin:settings", "system:work-sessions"];
export const SYSTEM_SERVER_STATUS_ACCESS = ["admin:settings", "system:server-status"];
export const SYSTEM_CLIENTS_ACCESS = ["admin:settings", "system:clients"];
export const SYSTEM_BACKUPS_ACCESS = ["admin:settings", "system:backups"];
export const SYSTEM_ROLL_ARCHIVE_ACCESS = ["admin:settings", "roll:read"];

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
  "settings:session",
  "system:activity",
  "system:work-sessions",
  "system:server-status",
  "system:clients",
  "system:backups",
];
