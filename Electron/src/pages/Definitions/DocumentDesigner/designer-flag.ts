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

export const DESIGNER_DISABLED_TITLE = "Belge tasarımcısı kapalı — Genel Ayarlar'dan açılır";
