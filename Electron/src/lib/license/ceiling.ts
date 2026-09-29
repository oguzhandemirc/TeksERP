import { MODULE_FIELD_BY_SETTING_KEY, MODULE_LABELS, type ModuleFlagKey } from "@/lib/module-flags";
import type { ModuleCeiling } from "@/types/license";

/**
 * Backend `ceilingAllows` aynası: tavan uygulanıyorsa modül lisanstaki listede
 * (liste yoksa serbest) VE dondurulanlarda değil. HAK anahtarları DB biçimindedir
 * (`finance.enabled`), panel alanı (`financeEnabled`) tablodan çevrilir.
 */
export function ceilingAllowsField(ceiling: ModuleCeiling, field: ModuleFlagKey): boolean {
  if (!ceiling.applies) return true;
  const key = Object.keys(MODULE_FIELD_BY_SETTING_KEY).find((k) => MODULE_FIELD_BY_SETTING_KEY[k] === field);
  if (!key) return true;
  return (ceiling.allowed === null || ceiling.allowed.includes(key)) && !ceiling.denied.includes(key);
}

/**
 * 403 `LICENSE_MODULE` → `details.modul`in DB anahtarı (`finance.enabled`). Sözleşmedeki
 * TEK biçim budur (protokol §14a); API alanı biçimi (`financeEnabled`) geriye uyum için
 * DB anahtarına çevrilir. Tanınmayan / eksik → null.
 */
export function licenseModuleKey(details: unknown): string | null {
  const raw = (details as { modul?: unknown } | null)?.modul;
  if (typeof raw !== "string" || !raw) return null;
  if (raw in MODULE_FIELD_BY_SETTING_KEY) return raw;
  const fromField = Object.keys(MODULE_FIELD_BY_SETTING_KEY).find((k) => MODULE_FIELD_BY_SETTING_KEY[k] === raw);
  return fromField ?? null;
}

/** DB anahtarının Türkçe modül adı (`finance.enabled` → "Ön muhasebe"); tanınmayan → null. */
export function licenseModuleLabel(settingKey: string | null): string | null {
  const field = settingKey ? MODULE_FIELD_BY_SETTING_KEY[settingKey] : undefined;
  return field ? MODULE_LABELS[field] : null;
}
