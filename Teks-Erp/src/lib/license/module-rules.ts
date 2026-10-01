// Lisans modül tavanının KATMAN kuralları (tasarım LISANS-V2 §3.1-2 · §3.3): çekirdek modül (üretim) her hâlde açıktır
// — lisans belirsizliği de K2 dondurması da fabrikanın üretimini kapatmaz (kademe kararı K4/K5'in işidir); bağımlı
// modül (`MODULE_DEPENDENCIES`: iplik → ticaret …) ön koşulu tavandan geçmeden açılmaz, tek bir okuyucu zinciri
// atlamasın diye kural okuyucuda değil tavanda.
import { MODULE_DEPENDENCIES } from "../../constants/module-flags";
import { MODULE_FIELD_BY_SETTING_KEY } from "../../constants/module-profiles";

/** Lisans tavanının kapatamadığı modüller (DB anahtarı). */
export const CORE_MODULES: ReadonlySet<string> = new Set(["production.enabled"]);

/** Bağımlı → ön koşul, DB anahtarıyla (`MODULE_DEPENDENCIES` alan adıyla tutar; ad uzayı burada çevrilir). */
export const MODULE_PREREQUISITE_BY_SETTING_KEY: Readonly<Record<string, string>> = (() => {
  const keyByField = new Map(Object.entries(MODULE_FIELD_BY_SETTING_KEY).map(([key, field]) => [field, key] as const));
  const out: Record<string, string> = {};
  for (const [dependent, prerequisite] of Object.entries(MODULE_DEPENDENCIES)) {
    const d = keyByField.get(dependent);
    const p = keyByField.get(prerequisite);
    // Eşlenemeyen ad: tavan bağımlılığı kuramaz → bağımlı modülü KAPAT (fail-closed); bekçi ölçer.
    if (d) out[d] = p ?? "__eslenemedi__";
  }
  return Object.freeze(out);
})();

/** Tavan bu anahtarı açıyor mu: çekirdek her zaman; aksi hâlde kendi izni ∧ ön koşul zinciri (döngüye karşı derinlik sınırlı). */
export function moduleAllowedByCeiling(key: string, ownAllowed: (key: string) => boolean, depth = 0): boolean {
  if (CORE_MODULES.has(key)) return true;
  if (depth > 8 || !ownAllowed(key)) return false;
  const prerequisite = MODULE_PREREQUISITE_BY_SETTING_KEY[key];
  return prerequisite === undefined || moduleAllowedByCeiling(prerequisite, ownAllowed, depth + 1);
}
