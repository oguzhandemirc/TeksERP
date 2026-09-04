import { SettingsSurfacePage } from "./SettingsSurfacePage";

/**
 * GENEL AYARLAR — "geri kalanlar" (2026-09-04 kullanıcı kararı).
 *
 * Şirket bilgileri · oturum & güvenlik · cihaz eşleştirme · etiket baskısı ·
 * bu bilgisayar. Davranış bayrakları buradan ÇIKTI (Sistem → Özellik
 * Anahtarları), modül anahtarları da (Sistem → Modüller).
 *
 * ⚠️ Sayfanın kapısı GENİŞ, içeriği DAR: `settings:workstation` taşıyan personel
 * girer ve yalnız "Bu Bilgisayar" bölümünün dört yerel kategorisini görür
 * (yazıcı · kantar · tabanca · sunucu adresi) — her biri kendi `permissionAny`sini
 * taşır. Bekçi: `workstation-rail.test.ts`.
 */
export function GeneralSettingsPage() {
  return <SettingsSurfacePage surface="settings" title="Genel Ayarlar" />;
}
