// Maliyet modülünün ayar satırı kayıttan bulunur (designerSettingPath kalıbı); elle yol yazılmaz.
import { SETTINGS_CATEGORIES, settingsCategoryPath, settingsCategoryTrail } from "@/pages/GeneralSettings/settings-config";

const MALIYET_FLAG_FIELD = "maliyetEnabled";
const maliyetCategory = () => SETTINGS_CATEGORIES.find((c) => c.flags?.some((f) => f.key === MALIYET_FLAG_FIELD));

export function maliyetSettingPath(): string {
  const cat = maliyetCategory();
  return cat ? settingsCategoryPath(cat) : "/system";
}

export function maliyetSettingTrail(): string {
  const cat = maliyetCategory();
  return cat ? settingsCategoryTrail(cat) : "Sistem";
}

export const MALIYET_CLOSED_TITLE = "Maliyet & Teklif modülü kapalı";
