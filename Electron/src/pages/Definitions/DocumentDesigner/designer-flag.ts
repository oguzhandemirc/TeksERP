import { SETTINGS_CATEGORIES, settingsCategoryPath, settingsCategoryTrail } from "@/pages/GeneralSettings/settings-config";

/**
 * Tasarımcı kapısı (plan P-c): `documents.designerEnabled`, API alanı
 * `documentDesignerEnabled`. Alan T1C'de doğar; o güne dek ya da yanıt
 * gelmemişken KAPALI sayılır — yalnız açıkça `true` açar (fail-closed).
 */
export const DESIGNER_FLAG_FIELD = "documentDesignerEnabled";

export function isDocumentDesignerEnabled(flags: unknown): boolean {
  if (typeof flags !== "object" || flags === null) return false;
  return (flags as Record<string, unknown>)[DESIGNER_FLAG_FIELD] === true;
}

export const DESIGNER_DISABLED_TITLE = "Belge tasarımcısı kapalı";

// Bayrağın ayar satırı (T1C "Belgeler" kategorisi) kayıttan bulunur; elle yol yazılmaz.
const designerCategory = () => SETTINGS_CATEGORIES.find((c) => c.flags?.some((f) => f.key === DESIGNER_FLAG_FIELD));

export function designerSettingPath(): string {
  const cat = designerCategory();
  return cat ? settingsCategoryPath(cat) : "/system";
}

export function designerSettingTrail(): string {
  const cat = designerCategory();
  return cat ? settingsCategoryTrail(cat) : "Sistem";
}
