import { flagSettingPath, flagSettingTrail } from "@/lib/flag-setting-path";

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

// Bayrağın ayar satırı (T1C "Belgeler" kategorisi) kayıttan bulunur — tek yardımcı `lib/flag-setting-path`.
export function designerSettingPath(): string {
  return flagSettingPath(DESIGNER_FLAG_FIELD);
}

export function designerSettingTrail(): string {
  return flagSettingTrail(DESIGNER_FLAG_FIELD);
}
