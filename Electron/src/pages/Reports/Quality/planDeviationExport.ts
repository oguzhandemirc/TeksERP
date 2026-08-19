// Plan-Sapma Karnesi → dışa aktarım spec'i (Excel · PDF · Yazdır tek kaynaktan).
//
// ⚠️ "İmza" ile "olay" ayrımı export'ta da korunur: kırılım tabloları İMZA sayar
// (renk+en birlikte sapan top BİR onaydır), alan tablosu OLAY sayar. Sütun
// başlıkları bunu açıkça söyler — aynı dosyada iki farklı sayım gören kullanıcı
// hangisinin ne olduğunu tahmin etmek zorunda kalmasın.

import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import type { PlanDeviationBreakdownRow, PlanDeviationScorecard } from "./service";

function breakdownTable(name: string, labelHeader: string, rows: PlanDeviationBreakdownRow[]): ReportTableSpec {
  return {
    name,
    columns: [
      { header: labelHeader, key: "label", width: 34 },
      { header: "Onay", key: "confirmations", width: 9, numFmt: "#,##0", align: "right" },
      { header: "Plan dışı (m)", key: "qtyM", width: 14, numFmt: "#,##0.0", align: "right" },
    ],
    rows: rows.map((r) => ({ label: r.label, confirmations: r.confirmations, qtyM: r.qtyM })),
    totalRow: {
      label: "TOPLAM",
      confirmations: rows.reduce((a, r) => a + r.confirmations, 0),
      qtyM: Math.round(rows.reduce((a, r) => a + r.qtyM, 0) * 10) / 10,
    },
  };
}

export function buildPlanDeviationExport(opts: {
  sc: PlanDeviationScorecard;
  periodLabel: string;
  compareLabel: string | null;
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel } = opts;
  const fieldLabel = (f: string) => (f === "color" ? "Renk" : f === "width" ? "En" : f);
  const sourceLabel = (s: string) =>
    s === "cut" ? "Kesim" : s === "finalize" ? "Kart bitirme" : s === "finalize-open-fabric" ? "Kalan bitirme" : s;

  return {
    title: "Plan-Sapma Karnesi",
    subtitle: `${periodLabel}${compareLabel ? ` · karşılaştırma: ${compareLabel}` : ""}`,
    meta: [
      `Plan dışı onay (imza): ${sc.summary.confirmations}`,
      `Plan dışı metraj: ${sc.summary.deviatedQtyM} m`,
      `Etkilenen top: ${sc.summary.affectedRolls}`,
      `Renk olayı: ${sc.summary.byField.color.events} · En olayı: ${sc.summary.byField.width.events}`,
      ...(sc.previous
        ? [`Önceki dönem: ${sc.previous.confirmations} onay · ${sc.previous.deviatedQtyM} m`]
        : []),
    ],
    tables: [
      breakdownTable("Onaylayan", "Operatör", sc.byOperator),
      breakdownTable("Kumaş + Renk", "Kumaş · Renk", sc.byItemColor),
      {
        name: "Günlük",
        columns: [
          { header: "Gün", key: "day", width: 12 },
          { header: "Onay", key: "confirmations", width: 9, numFmt: "#,##0", align: "right" },
          { header: "Plan dışı (m)", key: "qtyM", width: 14, numFmt: "#,##0.0", align: "right" },
        ],
        rows: sc.daily.map((d) => ({ day: d.day, confirmations: d.confirmations, qtyM: d.qtyM })),
      },
      {
        name: "Detay",
        columns: [
          { header: "Tarih", key: "date", width: 18 },
          { header: "Top", key: "roll", width: 20 },
          { header: "Çıkan top", key: "child", width: 20 },
          { header: "İş Emri", key: "wo", width: 18 },
          { header: "Alan", key: "field", width: 8 },
          { header: "Top değeri", key: "rollValue", width: 16 },
          { header: "Plan değeri", key: "planValue", width: 16 },
          { header: "Metraj (m)", key: "qtyM", width: 12, numFmt: "#,##0.0", align: "right" },
          { header: "Yol", key: "source", width: 14 },
          { header: "Onaylayan", key: "confirmedBy", width: 22 },
        ],
        rows: sc.detail.map((d) => ({
          date: new Date(d.createdAt).toLocaleString("tr-TR"),
          roll: d.rollBarcode ?? "—",
          child: d.childBarcode ?? "—",
          wo: d.workOrderNumber,
          field: fieldLabel(d.field),
          rollValue: d.rollValue ?? "—",
          planValue: d.planValue ?? "—",
          qtyM: d.qtyM,
          source: sourceLabel(d.source),
          confirmedBy: d.confirmedBy ?? "—",
        })),
        notes: [
          "Detay listesi en yeni 200 satırla sınırlıdır.",
          "Aynı topta renk ve en birlikte saptıysa iki satır görünür — bu TEK onaydır; başlıktaki metraj bir kez sayar.",
        ],
      },
    ],
  };
}
