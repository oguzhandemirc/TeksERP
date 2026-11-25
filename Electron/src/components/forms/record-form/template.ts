import type { RecordFormSpec, TemplateDraft } from "./types";

/** Kimlik ve sunucu damgaları: örnek taslağına HİÇBİR koşulda geçmez. */
const IDENTITY_KEYS = ["id", "createdAt", "updatedAt", "deletedAt", "createdById", "updatedById"] as const;

/**
 * "Örnek al" taslağı: kaynak satırın derin kopyası, kimliksiz; tekil alanlar boş ya da "… (kopya)".
 * Derin kopya → form taslağı değiştirse de kaynak nesne (seçici önbelleği) bayt bayt aynı kalır.
 */
export function toTemplateDraft<T extends { id: string }>(
  item: T,
  rule: RecordFormSpec<T>["templateRule"],
): TemplateDraft<T> {
  const copy = structuredClone(item) as Record<string, unknown>;
  for (const k of IDENTITY_KEYS) delete copy[k];
  for (const k of rule.clear ?? []) copy[k] = "";
  for (const k of rule.suggestCopy ?? []) {
    const v = copy[k];
    copy[k] = typeof v === "string" && v.trim() ? `${v} (kopya)` : "";
  }
  return copy as TemplateDraft<T>;
}

/** Oluşturma gövdesinden kimlik alanlarını söker (form `...initial` yaysa bile id sunucuya gitmez). */
export function stripIdentity<T>(values: Partial<T>): Partial<T> {
  const copy = { ...(values as Record<string, unknown>) };
  for (const k of IDENTITY_KEYS) delete copy[k];
  return copy as Partial<T>;
}
