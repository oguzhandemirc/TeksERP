// =============================================================================
// "Ne kadar iş aldık?" TABLO GÖRÜNÜMLERİ — eski Talep Analizi listeleri (2026-11-12)
// =============================================================================
// Ana/yan sayı, grafik ve anlatı Sipariş Karnesi'nden gelir; görünüm yalnız `tablo`yu eski
// raporun kendi servisinden (`getDemandAnalysis`, aynı süzgeç) kurar — sayı burada hesaplanmaz
// (bekçi `test_temel_rapor_esitlik` §S1v hücre hücre ölçer).

import type { BreakdownRow } from "../_breakdown";
import { getDemandAnalysis, type DemandAnalysisReport } from "../demand-analysis.report.service";
import type { ReportFilterInput } from "../_filters";
import type { DateRange } from "../_shared";
import type { TabloBlok } from "../sunum/sunum.types";

export const ORDER_DEMAND_VIEWS = ["ozet", "cesit", "kumas", "renk", "aylik"] as const;
export type OrderDemandView = (typeof ORDER_DEMAND_VIEWS)[number];
export const ORDER_DEMAND_VIEW_LABEL: Readonly<Record<OrderDemandView, string>> = {
  ozet: "Müşteri",
  cesit: "Kumaş + renk + en",
  kumas: "Kumaş",
  renk: "Renk",
  aylik: "Aylık talep (son 24 ay)",
};
/** Seçili dönemden bağımsız görünüm — ekranda uyarıyla söylenir (eski raporun "iki zaman kapsamı" ayrımı). */
export const MONTHLY_VIEW_NOTE = "Aylık talep tablosu seçili dönemden bağımsızdır: son 24 ayın siparişlerini gösterir.";

function breakdownTable(first: string, rows: readonly BreakdownRow[], withCompare: boolean): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "ad", baslik: first, hiza: "sol" },
      { anahtar: "kalem", baslik: "Kalem", birim: "adet", hiza: "sag" },
      { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
      ...(withCompare ? [{ anahtar: "onceki", baslik: "Önceki dönem", birim: "m" as const, hiza: "sag" as const }] : []),
    ],
    satirlar: rows.map((r) => ({ ad: r.label, kalem: r.count, metre: r.qty, ...(withCompare ? { onceki: r.prevQty ?? null } : {}) })),
  };
}

/** Kumaş + renk + en üçlüsü — depodaki malın karşıladığı birim; toplam satırı çekirdek çeşit sayısını söyler. */
function specTable(report: DemandAnalysisReport, withCompare: boolean): TabloBlok {
  const s = report.summary;
  return {
    kolonlar: [
      { anahtar: "kumas", baslik: "Kumaş", hiza: "sol" },
      { anahtar: "renk", baslik: "Renk", hiza: "sol" },
      { anahtar: "en", baslik: "En", hiza: "sag" },
      { anahtar: "kalem", baslik: "Kalem", birim: "adet", hiza: "sag" },
      { anahtar: "musteri", baslik: "Müşteri", birim: "adet", hiza: "sag" },
      { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
      { anahtar: "pay", baslik: "Pay", birim: "yuzde", hiza: "sag" },
      ...(withCompare ? [{ anahtar: "onceki", baslik: "Önceki dönem", birim: "m" as const, hiza: "sag" as const }] : []),
    ],
    satirlar: report.specs.map((r) => ({
      kumas: r.itemName, renk: r.colorName ?? "Renk belirtilmemiş", en: r.width, kalem: r.lineCount, musteri: r.customerCount,
      metre: r.qty, pay: r.sharePct, ...(withCompare ? { onceki: r.prevQty ?? null } : {}),
    })),
    toplam: { kumas: `Toplam: ${s.specCount} çeşit · talebin %80'i ilk ${s.coreSpecCount} çeşitte`, kalem: s.lineCount, metre: s.totalQty },
  };
}

function monthlyTable(report: DemandAnalysisReport): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "ay", baslik: "Ay", hiza: "sol" },
      { anahtar: "kalem", baslik: "Kalem", birim: "adet", hiza: "sag" },
      { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
    ],
    satirlar: report.monthly.map((m) => ({ ay: m.month, kalem: m.lineCount, metre: m.qty })),
  };
}

/** Görünüm → tablo (yalnız `ozet` dışı). Her hücre eski Talep Analizi'nin aynı alanı. */
export function orderDemandViewTable(view: Exclude<OrderDemandView, "ozet">, report: DemandAnalysisReport, withCompare: boolean): TabloBlok {
  switch (view) {
    case "cesit":
      return specTable(report, withCompare);
    case "kumas":
      return breakdownTable("Kumaş", report.byItem, withCompare);
    case "renk":
      return breakdownTable("Renk", report.byColor, withCompare);
    case "aylik":
      return monthlyTable(report);
  }
}

/** Görünümün kaynağı: eski Talep Analizi servisi, raporun kendi süzgeci ve kıyas dönemiyle. */
export async function loadOrderDemandView(
  view: Exclude<OrderDemandView, "ozet">,
  range: DateRange,
  compareRange: DateRange | null,
  filters: ReportFilterInput,
): Promise<{ table: TabloBlok; notes: string[] }> {
  const report = await getDemandAnalysis(range, compareRange, filters);
  const notes = view === "aylik" ? [MONTHLY_VIEW_NOTE] : [];
  if (view === "cesit" && report.summary.specsOmitted > 0) notes.push(`Kumaş + renk + en listesi ilk ${report.specs.length} çeşitle sınırlı; ${report.summary.specsOmitted} çeşit gösterilmedi.`);
  return { table: orderDemandViewTable(view, report, compareRange !== null), notes };
}
