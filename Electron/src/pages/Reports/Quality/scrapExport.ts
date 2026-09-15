// Fire Karnesi → dışa aktarım spec'i (Excel · PDF · Yazdır tek kaynaktan).

import type { BreakdownRow } from "../_components/BreakdownTable";
import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import type { ScrapScorecard } from "./service";

function qtyTable(name: string, labelHeader: string, rows: BreakdownRow[], hasCompare: boolean): ReportTableSpec {
  return {
    name,
    columns: [
      { header: labelHeader, key: "label", width: 28 },
      { header: "Top", key: "count", width: 8, numFmt: "#,##0", align: "right" },
      { header: "Hurda (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
      ...(hasCompare
        ? [
            { header: "Önceki (m)", key: "prevQty", width: 13, numFmt: "#,##0.0", align: "right" as const },
            { header: "Δ (m)", key: "delta", width: 11, numFmt: "#,##0.0", align: "right" as const },
          ]
        : []),
    ],
    rows: rows.map((r) => ({
      label: r.label,
      count: r.count,
      qty: r.qty,
      ...(hasCompare
        ? { prevQty: r.prevQty ?? 0, delta: Math.round((r.qty - (r.prevQty ?? 0)) * 10) / 10 }
        : {}),
    })),
    totalRow: {
      label: "TOPLAM",
      count: rows.reduce((a, r) => a + r.count, 0),
      qty: Math.round(rows.reduce((a, r) => a + r.qty, 0) * 10) / 10,
      ...(hasCompare
        ? {
            prevQty: Math.round(rows.reduce((a, r) => a + (r.prevQty ?? 0), 0) * 10) / 10,
            delta:
              Math.round(rows.reduce((a, r) => a + (r.qty - (r.prevQty ?? 0)), 0) * 10) / 10,
          }
        : {}),
    },
  };
}

export function buildScrapExport(opts: {
  sc: ScrapScorecard;
  periodLabel: string;
  compareLabel: string | null;
  /** Süzgeç satırları (K10) — ekrandakiyle AYNI dizi. */
  filterNotes?: string[];
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel, filterNotes = [] } = opts;
  const hasCompare = compareLabel !== null;

  const meta = [
    ...filterNotes,
    "HURDA metrajı, topun üretimi bitirip hurdaya ayrıldığı ana göre alınır.",
    // Bu cümle olmadan iki tablo toplanabilir sanılır ve hiçbir uyarı çıkmaz.
    "TESPİT tabloları AYRI bir zaman çıpası kullanır (hatanın görüldüğü an) ve ADET taşır — hurda metrajıyla toplanmaz.",
    `Toplam üretim ${sc.summary.producedQty} m (Kalite Karnesi ile aynı evren); fire oranı bunun üzerinden hesaplanır.`,
  ];
  if (compareLabel) meta.push(`Karşılaştırma dönemi: ${compareLabel}`);

  const detectionTable = (name: string, labelHeader: string, rows: ScrapScorecard["detectionByDefect"]): ReportTableSpec => ({
    name,
    columns: [
      { header: labelHeader, key: "label", width: 28 },
      { header: "Tespit", key: "count", width: 9, numFmt: "#,##0", align: "right" },
      { header: "Kesildi", key: "cutCount", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Tutuldu", key: "noCutCount", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Açık", key: "openCount", width: 9, numFmt: "#,##0", align: "right" },
    ],
    rows: rows.map((r) => ({ ...r })),
    totalRow: {
      label: "TOPLAM",
      count: rows.reduce((a, r) => a + r.count, 0),
      cutCount: rows.reduce((a, r) => a + r.cutCount, 0),
      noCutCount: rows.reduce((a, r) => a + r.noCutCount, 0),
      openCount: rows.reduce((a, r) => a + r.openCount, 0),
    },
  });

  return {
    title: "Fire Karnesi",
    subtitle: periodLabel,
    meta,
    tables: [
      qtyTable("Hurda — Hata Türü", "Hata türü", sc.scrapByDefect, hasCompare),
      qtyTable("Hurda — Kumaş", "Kumaş", sc.byItem, hasCompare),
      qtyTable("Hurda — Renk", "Renk", sc.byColor, hasCompare),
      qtyTable("Hurda — Kaynak", "Kaynak", sc.bySource, hasCompare),
      detectionTable("Tespit — Hata Türü", "Hata türü", sc.detectionByDefect),
      detectionTable("Tespit — İstasyon", "İstasyon", sc.detectionByStation),
      {
        name: "Günlük Seyir",
        columns: [
          { header: "Gün", key: "day", width: 12 },
          { header: "Hurda (m)", key: "scrapQty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Top", key: "scrapCount", width: 9, numFmt: "#,##0", align: "right" },
        ],
        rows: sc.daily.map((d) => ({ ...d })),
      },
    ],
  };
}
