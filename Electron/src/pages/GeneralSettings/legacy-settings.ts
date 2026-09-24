import {
  SETTINGS_CATEGORIES,
  SETTINGS_TAB_ALIASES,
  SURFACE_PATH,
  categorySurface,
  settingsCategoryPath,
} from "./settings-config";

/**
 * Eski `/system/settings?tab=<id>` adresinin bugünkü karşılığı. Kategori
 * (ya da eski takma adı) tanınırsa kendi ekranına, tanınmazsa Sistem hub'ına.
 * "Genel Ayarlar"ın ilk sekmesi Etiket Baskısı'ydı → `tab` yoksa Baskı & Cihazlar.
 */
export function legacySettingsTarget(tab: string | null): string {
  if (tab === null) return SURFACE_PATH.printing;
  const id = SETTINGS_TAB_ALIASES[tab] ?? tab;
  const cat = SETTINGS_CATEGORIES.find((c) => c.id === id);
  if (!cat || categorySurface(cat) === "vendor") return "/system";
  return settingsCategoryPath(cat);
}
