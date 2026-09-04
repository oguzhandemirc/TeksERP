import { SettingsSurfacePage } from "./SettingsSurfacePage";

/**
 * GENEL AYARLAR — "geri kalanlar" (2026-09-04 kullanıcı kararı).
 *
 * Şirket bilgileri · oturum & güvenlik · cihaz eşleştirme · etiket baskısı ·
 * bu bilgisayar. Davranış bayrakları buradan ÇIKTI (Sistem → Özellik
 * Anahtarları), modül anahtarları da (Sistem → Modüller).
 *
 * ⚠️ Sayfanın kapısı GENİŞ, içeriği DAR: `settings:workstation` taşıyan personel
 * girer ve yalnız "Bu Bilgisayar" kategorisini görür — bu davranış taşıma
 * sonrasında da aynen duruyor (kategori kendi `permissionAny`sini taşır).
 */
export function GeneralSettingsPage() {
  return <SettingsSurfacePage surface="settings" title="Genel Ayarlar" />;
}
