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
