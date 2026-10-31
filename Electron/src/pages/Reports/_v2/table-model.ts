// Rapor v2 tablosu — ekran hücresi ile PDF/Excel hücresi AYNI biçimden (`REPORT_NUM_FMTS`) basılır.
import type { ReportColumn, ReportTableSpec } from "@/pages/Reports/_components/reportExport";
import { reportCellText } from "@/lib/number-format";
import { BIRIM_METNI, PARA_BIRIMLERI, type TabloBlok, type TabloKolonu } from "./sunum";

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Para kolonu ve para kartı (`formatFigure`) TEK biçim: kuruşlu, sabit 2 ondalık (1e kararı, sektör standardı; D4-KUC2 g). */
export const MONEY_NUM_FMT = "#,##0.00";

/** Kolonun sayı biçimi: para kolonu sabit `MONEY_NUM_FMT`; diğeri hepsi tam sayıysa ondalıksız, değilse tek hane; sayı yoksa biçimsiz (literal: biçim bekçisi okur). */
export function columnFormat(table: TabloBlok, column: TabloKolonu): Pick<ReportColumn, "numFmt"> {
  const values = [...table.satirlar, ...(table.toplam ? [table.toplam] : [])].map((r) => r[column.anahtar]).filter(isNumber);
  if (values.length === 0) return {};
  // Kolon başına ölçülen ondalık aynı tablodaki TL kolonlarını "45.000,0" / "45.000" diye ayırıyordu.
  if (column.birim && PARA_BIRIMLERI.includes(column.birim)) return { numFmt: MONEY_NUM_FMT };
  return values.every((v) => Number.isInteger(v)) ? { numFmt: "#,##0" } : { numFmt: "#,##0.0" };
}

/** Başlık + birim: "Sevk (m)", "Oran (%)". */
export function columnHeader(column: TabloKolonu): string {
  return column.birim ? `${column.baslik} (${BIRIM_METNI[column.birim]})` : column.baslik;
}

export function columnAlign(table: TabloBlok, column: TabloKolonu): "left" | "right" {
  if (column.hiza === "sag") return "right";
  if (column.hiza === "sol" || column.hiza === "orta") return "left";
  return columnFormat(table, column).numFmt ? "right" : "left";
}

export function cellText(value: unknown, format: Pick<ReportColumn, "numFmt">): string {
  if (value === null || value === undefined || value === "") return "—";
  return reportCellText(value, format.numFmt);
}

/** Satır tavanı notu — "rapor bu kadar" ile "ilk N'i gösteriyoruz" ayrı şeylerdir. */
export function truncationNote(table: TabloBlok): string | null {
  const k = table.kesildi;
  if (!k) return null;
  return `İlk ${k.gosterilen.toLocaleString("tr-TR")} satır gösteriliyor (toplam ${k.toplam.toLocaleString("tr-TR")}).`;
}

/** Dışa aktarım tablosu — ekranla aynı başlık, aynı biçim. */
export function tableToExport(table: TabloBlok, name: string): ReportTableSpec {
  const note = truncationNote(table);
  return {
    name,
    columns: table.kolonlar.map((c) => ({
      header: columnHeader(c),
      key: c.anahtar,
      ...columnFormat(table, c),
      align: columnAlign(table, c),
    })),
    rows: table.satirlar,
    totalRow: table.toplam,
    notes: note ? [note] : undefined,
  };
}
