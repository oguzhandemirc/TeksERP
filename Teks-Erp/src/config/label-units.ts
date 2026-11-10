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

// =============================================================================
// ALAN BAŞINA BİÇİM — kanvas `field` elemanının `fmt`i (GK ihracat etiketi 2026-11-10)
// =============================================================================
// Şablon geneli birim sistemi tek satırda ya metrik ya ABD basar; ihracat etiketi aynı
// tuvalde "300 CM (118 INCHES)" ve "7,66 yds / 07,00 mt / 1,42 kg" ister. `fmt` yalnız o
// elemanın metnini biçimler; `fmt`siz eleman bugünkü yoldan bayt-aynı. Dönüşüm burada
// (şablonda hesap yok kuralı), katsayılar yukarıdaki tek kaynaktan.
// =============================================================================

export type FieldUsUnit = "yd" | "in" | "lb";
export type FieldDateFormat = "D.MM.YYYY" | "DD.MM.YYYY";
export const FIELD_DATE_FORMATS: readonly FieldDateFormat[] = ["D.MM.YYYY", "DD.MM.YYYY"];

export interface FieldFormat {
  /** ABD birimine çevir — boyutla eşleşmeli (m→yd, cm→in, kg→lb). */
  to?: FieldUsUnit;
  /** Sabit ondalık hane (0-3); yok → en çok 2, sondaki sıfırlar atılır. */
  decimals?: number;
  /** Tam kısmı bu haneye sıfırla doldur (1-4): 7,00 → "07,00". */
  padInt?: number;
  /** Birim metni ("yds", "mt", "CM"); "" → birimsiz; yok → dönüşüm birimi ya da m/cm/kg. */
  unit?: string;
  /** Yalnız tarih alanında: saatsiz fabrika günü; D = gün sıfırsız. */
  date?: FieldDateFormat;
}

/** `fmt` alabilen ölçü alanları ve boyutları. */
export const FIELD_MEASURE_DIM: Readonly<Record<string, MeasureDim>> = { widthCm: "cm", lengthMeters: "m", lengthCm: "cm", weightKg: "kg" };
/** `fmt.date` alabilen tarih alanları. */
export const FIELD_DATE_KEYS: ReadonlySet<string> = new Set(["printedAt", "woundAt"]);
export const FIELD_FORMAT_UNIT_MAX = 16;
const FIELD_FORMAT_KEYS = new Set(["to", "decimals", "padInt", "unit", "date"]);

/** `fmt` doğrulaması — hata metni ya da null. Bilinmeyen anahtar ve bağla uyuşmayan seçenek RED (fail-closed). */
export function fieldFormatError(raw: unknown, bind: string): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "fmt nesne olmalı";
  const f = raw as Record<string, unknown>;
  const unknownKey = Object.keys(f).find((k) => !FIELD_FORMAT_KEYS.has(k));
  if (unknownKey) return `fmt.${unknownKey} tanınmıyor. İzinli: to, decimals, padInt, unit, date`;
  const dim = FIELD_MEASURE_DIM[bind];
  const isDate = FIELD_DATE_KEYS.has(bind);
  if (!dim && !isDate) return `fmt yalnız ölçü (${Object.keys(FIELD_MEASURE_DIM).join(", ")}) ve tarih alanlarında kullanılabilir`;
  if (isDate) {
    if (Object.keys(f).some((k) => k !== "date")) return "Tarih alanında fmt yalnız date içerebilir";
    if (!(FIELD_DATE_FORMATS as readonly unknown[]).includes(f.date)) return `fmt.date geçersiz. İzinli: ${FIELD_DATE_FORMATS.join(", ")}`;
    return null;
  }
  if (f.date !== undefined) return "fmt.date yalnız tarih alanında kullanılabilir";
  if (f.to !== undefined && f.to !== US_UNIT[dim]) return `fmt.to bu alanda yalnız '${US_UNIT[dim]}' olabilir`;
  for (const [k, lo, hi] of [["decimals", 0, 3], ["padInt", 1, 4]] as const) {
    const v = f[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi)) return `fmt.${k} ${lo}-${hi} aralığında tamsayı olmalı`;
  }
  if (f.unit !== undefined) {
    if (typeof f.unit !== "string" || f.unit.length > FIELD_FORMAT_UNIT_MAX) return `fmt.unit en fazla ${FIELD_FORMAT_UNIT_MAX} karakter metin olmalı`;
    if (/[\u0000-\u001f\u007f]/.test(f.unit)) return "fmt.unit kontrol karakteri içeremez";
  }
  return null;
}

/** Kayıtlı `fmt` → biçim; geçersizse null (render bugünkü yola düşer). */
export function readFieldFormat(raw: unknown, bind: string): FieldFormat | null {
  return raw !== undefined && fieldFormatError(raw, bind) === null ? (raw as FieldFormat) : null;
}

/** Ölçü değeri + `fmt` → metin. Örn. 7 m {to:yd,decimals:2,unit:"yds"} → "7,66 yds". */
export function formatFieldMeasure(value: number, dim: MeasureDim, fmt: FieldFormat, decimalSep: LabelDecimalSep = ","): string {
  const n = fmt.to ? toUs(value, dim) : value;
  let txt = formatUnitNumber(n, { system: "METRIC", decimals: fmt.decimals ?? null, decimalSep });
  if (fmt.padInt) {
    const neg = txt.startsWith("-");
    const body = neg ? txt.slice(1) : txt;
    const cut = body.indexOf(decimalSep);
    const intPart = cut < 0 ? body : body.slice(0, cut);
    txt = `${neg ? "-" : ""}${intPart.padStart(fmt.padInt, "0")}${cut < 0 ? "" : body.slice(cut)}`;
  }
  const unit = fmt.unit !== undefined ? fmt.unit : (fmt.to ?? dim);
  return unit ? `${txt} ${unit}` : txt;
}
