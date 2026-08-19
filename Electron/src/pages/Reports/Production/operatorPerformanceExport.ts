// Operatör Performansı → dışa aktarım spec'i. Excel · PDF · Yazdır ÜÇÜ DE
// bundan türer (bkz. `_components/reportExport.ts` başlığı).
//
// Ekrandaki kolonların BİREBİR aynısı basılır: "ekranda gördüğüm ile indirdiğim
// aynı olsun". Grafik de dışarı çıkar — çünkü bir çubuk grafiği ekranda okunup
// Excel'de bulunamazsa kullanıcı "eksik indi" diye okur; grafiğin ARKASINDAKİ
// seri de bir tablodur ve öyle basılır.

import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import type { OperatorPerformanceRow } from "./service";

/** Ekrandaki "Operatör" hücresiyle aynı düşüş sırası: ad yoksa kullanıcı adı. */
const displayName = (r: OperatorPerformanceRow): string => r.fullName || r.username;

export function buildOperatorPerformanceExport(opts: {
  rows: OperatorPerformanceRow[];
  periodLabel: string;
  /** Ekrandaki grafik kaç operatör gösteriyorsa o kadar — tek kaynak sayfadadır. */
  chartRows?: OperatorPerformanceRow[];
}): ReportExportSpec {
  const { rows, periodLabel } = opts;
  const chartRows = opts.chartRows ?? rows.slice(0, 10);

  const totalOps = rows.reduce((a, r) => a + r.totalOps, 0);
  const activeCount = rows.length;

  const meta: string[] = [
    // Kartlardaki üç sayı ÇIKTIDA da dursun: Excel elden ele dolaşırken
    // "toplamı neye böleceğim" sorusunun cevabı kaybolmasın.
    `Aktif operatör: ${activeCount} · Toplam işlem: ${totalOps} · Operatör başına ort.: ${
      activeCount === 0 ? "—" : Math.round(totalOps / activeCount)
    }`,
    // Ölçünün TANIMI rakamla aynı dosyada olmalı — "işlem" top değildir.
    "Sayım İŞLEM adedidir, top adedi DEĞİL: kurşun görüp sonra QC2'den geçen tek bir top burada iki işlem sayılır.",
    "Dönem, işlemin kaydedildiği ana göre alınır. Kesimde çocuk toplara MİRAS kalan operasyonlar sayılmaz — her işlem yalnız kaynağında bir kez görünür.",
    "\"Fason\" sütunu fasona sevk ve fasondan dönüş operasyonlarını BİRLİKTE sayar; dört kırılım sütununun toplamı \"Toplam\"a eşittir.",
    "Liste işlem sayısına göre azalan ilk 50 operatörü içerir; dönemde hiç işlem yapmamış operatör listede YER ALMAZ (yani bu, personel listesi değildir).",
  ];

  const detail: ReportTableSpec = {
    name: "Detay (en yüksek 50)",
    columns: [
      { header: "Operatör", key: "fullName", width: 26 },
      { header: "Kullanıcı Adı", key: "username", width: 18 },
      { header: "Toplam", key: "totalOps", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Kurşun", key: "kursunCount", width: 10, numFmt: "#,##0", align: "right" },
      { header: "QC2", key: "qc2Count", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Tambur", key: "tamburCount", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Fason", key: "subcontractorOps", width: 10, numFmt: "#,##0", align: "right" },
    ],
    rows: rows.map((r) => ({
      fullName: displayName(r),
      username: r.username,
      totalOps: r.totalOps,
      kursunCount: r.kursunCount,
      qc2Count: r.qc2Count,
      tamburCount: r.tamburCount,
      subcontractorOps: r.subcontractorOps,
    })),
    totalRow: {
      fullName: "TOPLAM",
      username: "",
      totalOps,
      kursunCount: rows.reduce((a, r) => a + r.kursunCount, 0),
      qc2Count: rows.reduce((a, r) => a + r.qc2Count, 0),
      tamburCount: rows.reduce((a, r) => a + r.tamburCount, 0),
      subcontractorOps: rows.reduce((a, r) => a + r.subcontractorOps, 0),
    },
    notes: ["Toplam satırı YALNIZ listelenen operatörleri kapsar — kesilen kuyruk (50 dışı) dahil değildir."],
  };

  const chart: ReportTableSpec = {
    name: "En Aktif 10 Operatör",
    columns: [
      { header: "Operatör", key: "name", width: 26 },
      { header: "İşlem", key: "ops", width: 10, numFmt: "#,##0", align: "right" },
    ],
    rows: chartRows.map((r) => ({ name: displayName(r), ops: r.totalOps })),
    notes: ["Ekrandaki çubuk grafiğin arkasındaki seri — toplam işleme göre azalan sıralama."],
  };

  return {
    title: "Operatör Performansı",
    subtitle: periodLabel,
    meta,
    tables: [chart, detail],
  };
}
