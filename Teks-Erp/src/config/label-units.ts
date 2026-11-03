// =============================================================================
// Etiket BİRİM SİSTEMİ — şablon başına metrik | ABD | ikisi (Gülkesim cevap 3/3-ek)
// =============================================================================
// ABD'ye ihracat yapan müşterinin etiketi yard/inç/lb ister; bazısı metrik +
// ABD'yi yan yana. Ayar ŞABLONDA yaşar (`LabelTemplate.unitSettings`), baskı
// anında payload'a taşınır; değeri biçimleyen TEK yer `formatMeasure` — HTML,
// PPLA/PPLB/ZPL ve raster aynı metni basar. Ayar yok = bugünkü biçim (bayt-aynı).
// Şablonda hesap yapılmaz kuralı korunur: dönüşüm burada, şablon yalnız gösterir.
// =============================================================================

export type LabelUnitSystem = "METRIC" | "US" | "BOTH";
export const LABEL_UNIT_SYSTEMS: readonly LabelUnitSystem[] = ["METRIC", "US", "BOTH"];
export type LabelDecimalSep = "," | ".";

export interface LabelUnitSettings {
  system: LabelUnitSystem;
  /** Sabit ondalık hane (0-3). Yok → en çok 2 hane, sondaki sıfırlar atılır (bugünkü). */
  decimals?: number | null;
  /** Ondalık ayırıcı. Yok → "," (bugünkü TR biçimi). */
  decimalSep?: LabelDecimalSep | null;
}

/** Ölçü boyutu: uzunluk (m), en/boy (cm), ağırlık (kg). */
export type MeasureDim = "m" | "cm" | "kg";

/** Dönüşüm katsayıları — fabrika cevabı 3'teki değerler (tek kaynak). */
export const M_PER_YARD = 0.9144;
export const CM_PER_INCH = 2.54;
export const LB_PER_KG = 2.20462;

const US_UNIT: Record<MeasureDim, string> = { m: "yd", cm: "in", kg: "lb" };

export function toUs(value: number, dim: MeasureDim): number {
  if (dim === "m") return value / M_PER_YARD;
  if (dim === "cm") return value / CM_PER_INCH;
  return value * LB_PER_KG;
}

/** Ham JSON → doğrulanmış ayar; tanınmayan/eksik → null (bugünkü biçim). */
export function readLabelUnitSettings(raw: unknown): LabelUnitSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.system !== "string" || !(LABEL_UNIT_SYSTEMS as readonly string[]).includes(r.system)) return null;
  const decimals =
    typeof r.decimals === "number" && Number.isInteger(r.decimals) && r.decimals >= 0 && r.decimals <= 3
      ? r.decimals
      : null;
  const decimalSep = r.decimalSep === "." || r.decimalSep === "," ? r.decimalSep : null;
  return { system: r.system as LabelUnitSystem, decimals, decimalSep };
}

/** Ayar bugünkü biçimle bayt-aynı mı (METRIC + varsayılan ondalık + virgül). */
export function isDefaultUnitSettings(s: LabelUnitSettings | null | undefined): boolean {
  return !s || (s.system === "METRIC" && s.decimals == null && (s.decimalSep ?? ",") === ",");
}

/** Sayı → metin. Varsayılan: en çok 2 hane, binlik ayıracı yok, virgül (formatNumber ile aynı). */
export function formatUnitNumber(n: number, s?: LabelUnitSettings | null): string {
  const dec = s?.decimals;
  const txt = n.toLocaleString("tr-TR", {
    useGrouping: false,
    minimumFractionDigits: dec ?? 0,
    maximumFractionDigits: dec ?? 2,
  });
  return (s?.decimalSep ?? ",") === "." ? txt.replace(",", ".") : txt;
}

/**
 * Ölçü değeri + birim metni. METRIC "150 cm" · US "59,06 in" · BOTH "150 cm / 59,06 in".
 * `compact` → birim sayıya bitişik ("230,5m") — metraj bandının dar şeridi için.
 */
export function formatMeasure(
  value: number,
  dim: MeasureDim,
  s?: LabelUnitSettings | null,
  opts: { unit?: boolean; compact?: boolean } = {},
): string {
  const unit = opts.unit !== false;
  const sep = opts.compact ? "" : " ";
  const metric = `${formatUnitNumber(value, s)}${unit ? sep + dim : ""}`;
  const system = s?.system ?? "METRIC";
  if (system === "METRIC") return metric;
  const us = `${formatUnitNumber(toUs(value, dim), s)}${unit ? sep + US_UNIT[dim] : ""}`;
  return system === "US" ? us : `${metric} / ${us}`;
}
