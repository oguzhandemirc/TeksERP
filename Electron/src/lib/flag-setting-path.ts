// Bayrağın ayar satırına giden yol — TEK yardımcı (UX-2 K3). Eski `designerSettingPath`/`maliyetSettingPath` buna delege eder.
// Satır kayıttan (`SETTINGS_CATEGORIES`) bulunur; elle yol yazılmaz — ekran bölünüp adı değişince eski yol yalan söyler.
import { SETTINGS_CATEGORIES, settingsCategoryPath, settingsCategoryTrail } from "@/pages/GeneralSettings/settings-config";

const categoryOf = (flagKey: string) => SETTINGS_CATEGORIES.find((c) => c.flags?.some((f) => f.key === flagKey));

/** Bayrağın ayar ekranı adresi; satır bulunamazsa Sistem hub'ı. */
export function flagSettingPath(flagKey: string): string {
  const cat = categoryOf(flagKey);
  return cat ? settingsCategoryPath(cat) : "/system";
}

/** Bayrağın menü yolu ("Sistem → Modüller"); satır bulunamazsa "Sistem". */
export function flagSettingTrail(flagKey: string): string {
  const cat = categoryOf(flagKey);
  return cat ? settingsCategoryTrail(cat) : "Sistem";
}

/** Kapalı karo / menü satırının ipucu: "kapalı — <ayar yolu>" (K3: kapalı özellik görünür kalır, nereden açılacağını söyler). */
export function flagOffHint(flagKey: string): string {
  return `kapalı — ${flagSettingTrail(flagKey)}`;
}
