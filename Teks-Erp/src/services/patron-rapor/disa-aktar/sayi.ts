// =============================================================================
// Patron rapor dosyası — sayı/kart metni. Panelin `lib/format.ts` + `lib/number-format.ts` + `_v2/figures.ts`
// AYNASI (iki kopya kararı 2026-11-13): sapmayı altın dosya ölçer (`test_patron_rapor_disa_aktar` +
// panel `patronDisaAktarAltin.test.ts`). Para binlik ayırıcılı, ölçü/sayım/yüzde ayırıcısız; ondalık virgül.
// =============================================================================
import { BIRIM_METNI, PARA_BIRIMLERI, type AnaSayi, type Birim } from "../../reports/sunum/sunum.types";

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(min: number, max: number, grouping: boolean): Intl.NumberFormat {
  const key = `${min}:${max}:${grouping ? 1 : 0}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: min, maximumFractionDigits: Math.max(min, max), useGrouping: grouping });
    formatterCache.set(key, f);
  }
  return f;
}

/** Ham sınıflı biçim ("-0" düzeltmesi YOK — Excel de sıfıra yuvarlanan negatifi "-0,0" gösterir). */
function formatClassed(n: number, min: number, max: number, grouped: boolean): string {
  return formatter(min, max, grouped).format(n);
}

const noNegZero = (s: string): string => (/^-0(,0+)?$/.test(s) ? s.slice(1) : s);

/** Gösterim sayısı (ayırıcısız, en çok `max` hane) — panel `formatDisplay`. */
export function formatDisplay(n: number, max = 1): string {
  return Number.isFinite(n) ? noNegZero(formatter(0, max, false).format(n)) : "—";
}

const fixedDecimalsOf = (numFmt: string): number => /\.([0#]+)/.exec(numFmt)?.[1]?.length ?? 0;
const isGroupedNumFmt = (numFmt: string): boolean => numFmt.includes(",");

/** Rapor hücresinin PDF metni — panel `reportCellText`. */
export function reportCellText(v: unknown, numFmt?: string): string {
  if (numFmt === undefined || v === null || v === undefined || v === "") return String(v ?? "");
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const d = fixedDecimalsOf(numFmt);
  return formatClassed(n, d, d, isGroupedNumFmt(numFmt));
}

/** Rapor kolonunun Excel biçimi — panel `reportExcelNumFmt`. */
export function reportExcelNumFmt(numFmt: string): string {
  const d = fixedDecimalsOf(numFmt);
  const base = isGroupedNumFmt(numFmt) ? "#,##0" : "0";
  return d > 0 ? `${base}.${"0".repeat(d)}` : base;
}

export const MONEY_NUM_FMT = "#,##0.00";
export const NOT_MEASURED_TEXT = "Ölçülemedi";

/** Değer + birim: "%78" · "42300 m" · "1.200,00 TL"; `null` → "Ölçülemedi" — panel `formatFigure`. */
export function formatFigure(value: number | null, unit: Birim): string {
  if (value === null || !Number.isFinite(value)) return NOT_MEASURED_TEXT;
  if (unit === "yuzde") return `%${formatDisplay(value, 1)}`;
  if (PARA_BIRIMLERI.includes(unit)) return `${reportCellText(value, MONEY_NUM_FMT)} ${BIRIM_METNI[unit]}`;
  return `${formatDisplay(value, 1)} ${BIRIM_METNI[unit]}`;
}

const ARROW = { artti: "▲", azaldi: "▼", degismedi: "＝" } as const;

/** Kıyas satırı "▼ 6 puan (Eylül 2026: %84)" — panel `comparisonText`. */
export function comparisonText(figure: AnaSayi, periodLabel?: string): string | null {
  const c = figure.kiyas;
  if (!c) return null;
  const before = c.deger === null ? NOT_MEASURED_TEXT : formatFigure(c.deger, figure.birim);
  const tail = periodLabel ? ` (${periodLabel}: ${before})` : ` (önceki: ${before})`;
  if (c.yon === null || c.fark === null) return `Kıyas yapılamadı${tail}`;
  if (c.yon === "degismedi") return `${ARROW.degismedi} Değişmedi${tail}`;
  const arrow = ARROW[c.yon];
  if (figure.birim === "yuzde") return `${arrow} ${formatDisplay(Math.abs(c.fark), 1)} puan${tail}`;
  if (c.yuzde !== null) return `${arrow} %${formatDisplay(Math.abs(c.yuzde), 1)}${tail}`;
  return `${arrow} ${formatFigure(Math.abs(c.fark), figure.birim)}${tail}`;
}
