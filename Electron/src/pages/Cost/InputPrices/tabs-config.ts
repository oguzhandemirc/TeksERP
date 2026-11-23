import { Factory, FunctionSquare, PackageOpen, Spool, type LucideIcon } from "lucide-react";

export type CostInputTabKey = "yarn" | "finishing" | "formulas" | "norms";

/** Sekme başlığının ⓘ metni — tek başına sayfa ile sekmeli sayfa aynı cümleyi okur. */
export const COST_INPUT_DESCRIPTIONS: Record<CostInputTabKey, string> = {
  yarn: "Maliyet hesabında kullanılan kg fiyatı. Değişiklik yeni satır yazar, eski fiyat damgalı kalır; kayıtlı standart maliyetler değişmez.",
  finishing: "Terbiye/boya/apre fason ücretleri — kumaşın maliyet yapısı tarifeyi koduyla çağırır. Değişiklik yeni sürümdür.",
  formulas:
    "Fabrikaya özel ek maliyet kalemleri (pul işçiliği, ambalaj payı…) — metre başına formülle hesaplanır, genel giderden önce maliyete eklenir. Değişiklik yeni sürümdür.",
  norms: "Bir hizmetin metresi için harcanan sarf (ip, kurşun…). Değişiklik şu andan itibaren geçerli yeni sürümdür; eski norm damgalı kalır.",
};

export interface CostInputTabDef {
  key: CostInputTabKey;
  /** Sekme şeridindeki kısa ad. */
  label: string;
  /** Komut paletindeki tam ad (eski ekran adı — kullanıcı bununla arar). */
  paletteLabel: string;
  icon: LucideIcon;
}

/**
 * Girdi Fiyatları sekmeleri — TEK KAYNAK. Sayfa şeridi, eski yolların yönlendirmesi ve
 * komut paletinin `?tab=<key>` derin bağlantıları buradan okur.
 */
export const COST_INPUT_TABS: CostInputTabDef[] = [
  { key: "yarn", label: "İplik Fiyatları", paletteLabel: "İplik Maliyet Fiyatları", icon: Spool },
  { key: "finishing", label: "Fason Tarifeleri", paletteLabel: "Fason Tarifeleri", icon: Factory },
  { key: "formulas", label: "Formüller", paletteLabel: "Maliyet Formülleri", icon: FunctionSquare },
  { key: "norms", label: "Sarf Normları", paletteLabel: "Hizmet Sarf Normları", icon: PackageOpen },
];

export const COST_INPUT_PATH = "/cost/input-prices";

export function costInputTabPath(key: CostInputTabKey): string {
  return `${COST_INPUT_PATH}?tab=${key}`;
}

const TAB_KEYS = new Set<CostInputTabKey>(COST_INPUT_TABS.map((t) => t.key));

export function resolveCostInputTab(v: string | null): CostInputTabKey {
  return v !== null && TAB_KEYS.has(v as CostInputTabKey) ? (v as CostInputTabKey) : "yarn";
}
