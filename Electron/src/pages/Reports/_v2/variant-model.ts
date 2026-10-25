// Varyant (küçük çoklular) + dönem kıyası — SAF yardımcılar; bileşen testi ve dışa aktarım aynı metni kullanır.
// Hücre ve dönem değerleri sunucudan gelir; istemci yalnız biçimler (sayı uydurmaz, "Ölçülemedi" 0'a çökmez).
import type { ReportTableSpec } from "@/pages/Reports/_components/reportExport";
import { comparisonText, formatFigure, NOT_MEASURED_TEXT } from "./figures";
import type { ComparisonTone, DonemBlok, VaryantBlok, VaryantHucresi } from "./sunum";

export const VARIANT_PARAM = "varyant";
export const PERIODS_PARAM = "donemler";

/** Seçim yokluğunun çip metni — "Tümü" bu iki çipte anlamsız: varyant yoksa "Tek", dönem kıyası yoksa "Kapalı". */
export function emptyLabelOf(paramName: string): string | undefined {
  if (paramName === VARIANT_PARAM) return "Tek";
  if (paramName === PERIODS_PARAM) return "Kapalı";
  return undefined;
}

/** Hücre tıkı: o değerle süzülmüş tek rapora geç — süzgeç anahtarı yazılır, varyant kalkar. */
export function cellFilterSearch(search: URLSearchParams, block: VaryantBlok, cell: VaryantHucresi): URLSearchParams | null {
  if (!block.suzgecAnahtari) return null;
  const next = new URLSearchParams(search);
  next.delete(VARIANT_PARAM);
  next.set(block.suzgecAnahtari, cell.deger);
  return next;
}

/** Ortak eksen: her hücrenin çubuğu en büyük hücreye oranlı (0..1); ölçülemeyen ya da negatif → null. */
export function cellRatios(cells: readonly VaryantHucresi[]): Array<number | null> {
  const values = cells.map((c) => (c.anaSayi.deger !== null && Number.isFinite(c.anaSayi.deger) && c.anaSayi.deger >= 0 ? c.anaSayi.deger : null));
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  return values.map((v) => (v === null ? null : max > 0 ? v / max : 0));
}

export interface PeriodColumn {
  key: string;
  label: string;
  value: string;
  /** Yalnız son sütun (bir öncekiyle kıyaslı). */
  comparison: string | null;
  tone: ComparisonTone | undefined;
  notMeasured: boolean;
  reason?: string;
}

export function periodColumns(periods: readonly DonemBlok[]): PeriodColumn[] {
  return periods.map((d, i) => {
    const last = i === periods.length - 1;
    const prev = i > 0 ? periods[i - 1] : undefined;
    return {
      key: `${d.from}|${d.to}`,
      label: d.etiket,
      value: formatFigure(d.anaSayi.deger, d.anaSayi.birim),
      comparison: last && prev ? comparisonText(d.anaSayi, prev.etiket) : null,
      tone: last ? d.anaSayi.kiyas?.durum : undefined,
      notMeasured: d.anaSayi.deger === null,
      reason: d.anaSayi.olculemedi,
    };
  });
}

/** Dışa aktarım: küçük çoklular — ekrandaki metinle aynı (değer + kıyas satırı). */
export function variantToExport(block: VaryantBlok, periodLabel?: string): ReportTableSpec | null {
  const cells = block.hucreler ?? [];
  if (cells.length === 0) return null;
  return {
    name: `${block.boyutEtiketi} kırılımı`,
    columns: [
      { header: block.boyutEtiketi, key: "ad" },
      { header: cells[0]!.anaSayi.ad, key: "deger", align: "right" },
      { header: "Kıyas", key: "kiyas" },
    ],
    rows: cells.map((c) => ({ ad: c.ad, deger: formatFigure(c.anaSayi.deger, c.anaSayi.birim), kiyas: comparisonText(c.anaSayi, periodLabel) ?? "" })),
  };
}

/** Dışa aktarım: dönem kıyası tek tablo, dönemler satır (PDF dar sayfada yan yana sütun taşar). */
export function periodsToExport(periods: readonly DonemBlok[]): ReportTableSpec | null {
  if (periods.length === 0) return null;
  const cols = periodColumns(periods);
  return {
    name: "Dönem kıyası",
    columns: [
      { header: "Dönem", key: "donem" },
      { header: periods[0]!.anaSayi.ad, key: "deger", align: "right" },
      { header: "Kıyas", key: "kiyas" },
    ],
    rows: cols.map((c) => ({ donem: c.label, deger: c.notMeasured && c.reason ? `${NOT_MEASURED_TEXT} (${c.reason})` : c.value, kiyas: c.comparison ?? "" })),
  };
}
