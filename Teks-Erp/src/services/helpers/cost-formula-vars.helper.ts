// =============================================================================
// MALİYET FORMÜLÜ DEĞİŞKEN KATALOĞU — formülün okuyabildiği TEK liste (SY-C1)
// =============================================================================
// Kayıt (400 denetimi), panel ⓘ listesi ve motor değer bağlama AYNI katalogdan okur. Değerler
// motorun o ana kadarki ara sonuçlarıdır (metre başına); formül satırı ek işlemlerden sonra gelir.
// `bagli: false` = yer tutucu: adı ayrılmıştır ama değeri henüz yok — kayıtta 400
// `COST_FORMULA_VARIABLE_UNAVAILABLE`, sessiz 0 yok (bugün yer tutucu yok; `pulAdet` SY-d'de bağlandı).
// =============================================================================

export interface CostFormulaVariable {
  name: string;
  label: string;
  unit: string;
  bagli: boolean;
  /** Önizlemenin örnek değeri (panel canlı hesabı bununla başlar). */
  sample: string;
}

export const COST_FORMULA_VARIABLES: readonly CostFormulaVariable[] = [
  { name: "metre", label: "Bir metre (sabit 1) — metre başı ücret yazmak için", unit: "m", bagli: true, sample: "1" },
  { name: "atkiSikligi", label: "Atkı sıklığı", unit: "atkı/cm", bagli: true, sample: "17" },
  { name: "en", label: "Atkı boyu (tarak eni + kenar payı)", unit: "cm", bagli: true, sample: "350" },
  { name: "cozguTel", label: "Zemin çözgü tel sayısı", unit: "tel", bagli: true, sample: "3500" },
  { name: "cozguKg", label: "Çözgü ipliği (fireli)", unit: "kg/m", bagli: true, sample: "0.14" },
  { name: "atkiKg", label: "Atkı ipliği (fireli)", unit: "kg/m", bagli: true, sample: "0.122" },
  { name: "iplikKg", label: "Toplam iplik (çözgü + atkı, fireli)", unit: "kg/m", bagli: true, sample: "0.262" },
  { name: "hamMaliyet", label: "Ham metre maliyeti", unit: "TL/m", bagli: true, sample: "48" },
  { name: "mamulMaliyet", label: "Mamul metre maliyeti (terbiye + ek işlemler dahil)", unit: "TL/m", bagli: true, sample: "65" },
  { name: "usd", label: "Dolar kuru (1 USD kaç TL)", unit: "TL", bagli: true, sample: "41.85" },
  { name: "eur", label: "Euro kuru (1 EUR kaç TL)", unit: "TL", bagli: true, sample: "45.2" },
  // SY-d: adetle alınan atkı ipliği (iplik kartı birimi ADET) — atkı boyu × kartın metredeki adedi, fireli; yoksa 0.
  { name: "pulAdet", label: "Pul adedi — adetle alınan atkı ipliğinin kumaş metresindeki adedi (fireli; yoksa 0)", unit: "adet/m", bagli: true, sample: "1200" },
];

export const COST_FORMULA_VARIABLE_NAMES: ReadonlySet<string> = new Set(COST_FORMULA_VARIABLES.map((v) => v.name));
export const COST_FORMULA_UNBOUND_VARIABLES: ReadonlySet<string> = new Set(COST_FORMULA_VARIABLES.filter((v) => !v.bagli).map((v) => v.name));
