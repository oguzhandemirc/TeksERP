// Kalite Karnesi → dışa aktarım spec'i. Excel · PDF · Yazdır ÜÇÜ DE bundan
// türer (bkz. `_components/reportExport.ts` başlığı).
//
// Ekrandaki tablolarla aynı kolonları taşır: "ekranda gördüğüm ile indirdiğim
// aynı olsun" — farklılaşırsa kullanıcı hangisine güveneceğini bilemez.

import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import type { QualityScorecard, ScorecardBreakdownRow } from "./service";

const UNGRADED = "__UNGRADED__";

function gradeColumns(sc: QualityScorecard) {
  // Kolon sırası KATALOG sırasıdır (backend `gradeOrder`), ekrandakiyle aynı.
  // Yalnız o dönemde GERÇEKTEN görülen kaliteler basılır — hiç üretilmemiş bir
  // kalitenin sıfırlarla dolu kolonu tabloyu okunmaz yapar.
  const seen = new Set<string>();
  for (const r of [...sc.byItem, ...sc.byColor, ...sc.bySubcontractor]) {
    for (const k of Object.keys(r.qtyByGrade)) seen.add(k);
  }
  return sc.gradeOrder.filter((g) => seen.has(g.code));
}

function breakdownTable(
  name: string,
  labelHeader: string,
  rows: ScorecardBreakdownRow[],
  sc: QualityScorecard,
  hasCompare: boolean,
): ReportTableSpec {
  const grades = gradeColumns(sc);
  const columns = [
    { header: labelHeader, key: "label", width: 28 },
    { header: "Top", key: "rollCount", width: 8, numFmt: "#,##0", align: "right" as const },
    { header: "Toplam (m)", key: "totalQty", width: 13, numFmt: "#,##0.0", align: "right" as const },
    ...grades.map((g) => ({
      header: `${g.name} (m)`,
      key: `g_${g.code}`,
      width: 14,
      numFmt: "#,##0.0",
      align: "right" as const,
    })),
    { header: `${sc.summary.topGrade?.name ?? "Üst kalite"} %`, key: "topGradePct", width: 12, numFmt: "0.0", align: "right" as const },
    ...(hasCompare
      ? [
          { header: "Önceki (m)", key: "prevTotalQty", width: 13, numFmt: "#,##0.0", align: "right" as const },
          { header: "Önceki %", key: "prevTopGradePct", width: 11, numFmt: "0.0", align: "right" as const },
          { header: "Δ %", key: "deltaPct", width: 9, numFmt: "0.0", align: "right" as const },
        ]
      : []),
  ];

  const mapped = rows.map((r) => {
    const base: Record<string, unknown> = {
      label: r.label,
      rollCount: r.rollCount,
      totalQty: r.totalQty,
      topGradePct: r.topGradePct,
    };
    for (const g of grades) base[`g_${g.code}`] = r.qtyByGrade[g.code] ?? 0;
    if (hasCompare) {
      base.prevTotalQty = r.prevTotalQty ?? 0;
      base.prevTopGradePct = r.prevTopGradePct ?? 0;
      base.deltaPct = Math.round((r.topGradePct - (r.prevTopGradePct ?? 0)) * 10) / 10;
    }
    return base;
  });

  const total: Record<string, unknown> = {
    label: "TOPLAM",
    rollCount: rows.reduce((a, r) => a + r.rollCount, 0),
    totalQty: Math.round(rows.reduce((a, r) => a + r.totalQty, 0) * 10) / 10,
    topGradePct: sc.summary.topGrade?.pct ?? 0,
  };
  for (const g of grades) {
    total[`g_${g.code}`] =
      Math.round(rows.reduce((a, r) => a + (r.qtyByGrade[g.code] ?? 0), 0) * 10) / 10;
  }
  if (hasCompare) {
    total.prevTotalQty = sc.summary.prevTotalQty ?? 0;
    total.prevTopGradePct = sc.summary.prevTopGradePct ?? 0;
    total.deltaPct =
      Math.round(((sc.summary.topGrade?.pct ?? 0) - (sc.summary.prevTopGradePct ?? 0)) * 10) / 10;
  }

  return { name, columns, rows: mapped, totalRow: total };
}

export function buildScorecardExport(opts: {
  sc: QualityScorecard;
  periodLabel: string;
  compareLabel: string | null;
  /** Süzgeç satırları (K10) — ekrandakiyle AYNI dizi. */
  filterNotes?: string[];
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel, filterNotes = [] } = opts;
  const hasCompare = compareLabel !== null;

  const meta: string[] = [
    ...filterNotes,
    // Ölçünün TANIMI rakamla aynı dosyada durmalı: Excel elden ele dolaşırken
    // "bu yüzde neyin yüzdesi" sorusunun cevabı kaybolmasın.
    "Oranlar METRAJ ağırlıklıdır (top adedi değil). Dönem, topun üretimi bitirip rafına girdiği ana göre alınır.",
    "Tüketilmiş toplar (Tambur/fason kesiminde çocuklarına dönüşenler) ve iptaller sayılmaz; fire SAYILIR.",
  ];
  if (compareLabel) meta.push(`Karşılaştırma dönemi: ${compareLabel}`);
  if (sc.unanchoredRollCount > 0) {
    meta.push(
      `⚠ ${sc.unanchoredRollCount} top üretim tarihi bilinmediği için hiçbir döneme dahil edilmedi.`,
    );
  }

  const gradeTable: ReportTableSpec = {
    name: "Kalite Dağılımı",
    columns: [
      { header: "Kalite", key: "name", width: 22 },
      { header: "Top", key: "rollCount", width: 8, numFmt: "#,##0", align: "right" },
      { header: "Metraj (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
      { header: "Pay %", key: "pct", width: 10, numFmt: "0.0", align: "right" },
      ...(hasCompare
        ? [
            { header: "Önceki (m)", key: "prevQty", width: 13, numFmt: "#,##0.0", align: "right" as const },
            { header: "Önceki %", key: "prevPct", width: 11, numFmt: "0.0", align: "right" as const },
          ]
        : []),
    ],
    rows: sc.grades.map((g) => ({
      name: g.code === UNGRADED ? "Belirsiz (kalite girilmemiş)" : g.name,
      rollCount: g.rollCount,
      qty: g.qty,
      pct: g.pct,
      ...(hasCompare ? { prevQty: g.prevQty ?? 0, prevPct: g.prevPct ?? 0 } : {}),
    })),
    totalRow: {
      name: "TOPLAM",
      rollCount: sc.summary.rollCount,
      qty: sc.summary.totalQty,
      pct: 100,
      ...(hasCompare ? { prevQty: sc.summary.prevTotalQty ?? 0, prevPct: 100 } : {}),
    },
  };

  return {
    title: "Kalite Karnesi",
    subtitle: periodLabel,
    meta,
    tables: [
      gradeTable,
      breakdownTable("Kumaş Bazında", "Kumaş", sc.byItem, sc, hasCompare),
      breakdownTable("Renk Bazında", "Renk", sc.byColor, sc, hasCompare),
      breakdownTable("Fason Bazında", "Kaynak", sc.bySubcontractor, sc, hasCompare),
      {
        name: "Günlük Seyir",
        columns: [
          { header: "Gün", key: "day", width: 12 },
          { header: "Toplam (m)", key: "totalQty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: `${sc.summary.topGrade?.name ?? "Üst kalite"} (m)`, key: "topGradeQty", width: 15, numFmt: "#,##0.0", align: "right" },
          { header: "Oran %", key: "topGradePct", width: 10, numFmt: "0.0", align: "right" },
        ],
        rows: sc.daily.map((d) => ({ ...d })),
      },
    ],
  };
}
