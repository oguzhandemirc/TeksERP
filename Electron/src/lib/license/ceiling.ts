import { MODULE_FIELD_BY_SETTING_KEY, type ModuleFlagKey } from "@/lib/module-flags";
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
