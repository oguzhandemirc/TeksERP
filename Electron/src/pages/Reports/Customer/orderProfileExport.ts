// Müşteri Sipariş Profili → dışa aktarım spec'i. Excel · PDF · Yazdır ÜÇÜ DE
// bundan türer (bkz. `_components/reportExport.ts` başlığı).
//
// Ekrandaki `DetailTable` ile AYNI kolonları taşır: "ekranda gördüğüm ile
// indirdiğim aynı olsun" — farklılaşırsa kullanıcı hangisine güveneceğini
// bilemez.

import type { ReportExportSpec } from "../_components/reportExport";
import { fmtDate } from "../_components/formatters";
import type { CustomerOrderProfileRow } from "./service";

export function buildOrderProfileExport(opts: {
  rows: CustomerOrderProfileRow[];
  /** Ekrandaki "dönem" karşılığı — bu rapor bir SNAPSHOT'tır, aralığı yoktur. */
  asOfLabel: string;
}): ReportExportSpec {
  const { rows, asOfLabel } = opts;

  return {
    title: "Müşteri Sipariş Profili",
    subtitle: asOfLabel,
    // Kapsam uyarıları rakamla AYNI dosyada durmalı: Excel elden ele dolaşırken
    // "neden bizim müşteri listede yok" / "bu sayı hangi aralığa ait" sorularının
    // cevabı ekranda kalırsa dosya yanlış okunur.
    meta: [
      "Bu rapor bir SNAPSHOT'tır — tarih aralığı filtresi yoktur, tüm zamanların siparişleri sayılır.",
      "Yalnız AKTİF müşteriler ve en az bir sipariş vermiş olanlar listelenir.",
      "En çok sipariş veren 200 müşteri ile sınırlıdır.",
      "Favori kumaş / renk / en = o müşterinin sipariş KALEMLERİNDE en sık geçen değerdir (metraja göre değil, kalem adedine göre).",
    ],
    tables: [
      {
        name: "Müşteri Sipariş Profili",
        columns: [
          { header: "Kod", key: "customerCode", width: 14 },
          { header: "Müşteri", key: "customerName", width: 32 },
          { header: "Sipariş", key: "orderCount", width: 10, numFmt: "#,##0", align: "right" },
          { header: "Kalem", key: "lineCount", width: 10, numFmt: "#,##0", align: "right" },
          { header: "Favori Kumaş", key: "topItemName", width: 26 },
          { header: "Favori Renk", key: "topColorName", width: 20 },
          { header: "Favori En (cm)", key: "topWidth", width: 14, numFmt: "#,##0", align: "right" },
          { header: "Son Sipariş", key: "lastOrderDate", width: 14, align: "right" },
        ],
        rows: rows.map((r) => ({
          customerCode: r.customerCode,
          customerName: r.customerName,
          orderCount: r.orderCount,
          lineCount: r.lineCount,
          // Ekranda boş değer "—" basılıyor; dosyada da öyle dursun ki boş hücre
          // "veri kayboldu" gibi okunmasın.
          topItemName: r.topItemName || "—",
          topColorName: r.topColorName || "—",
          topWidth: r.topWidth === null ? "—" : r.topWidth,
          lastOrderDate: fmtDate(r.lastOrderDate),
        })),
        totalRow: {
          customerCode: "TOPLAM",
          customerName: `${rows.length} müşteri`,
          orderCount: rows.reduce((a, r) => a + r.orderCount, 0),
          lineCount: rows.reduce((a, r) => a + r.lineCount, 0),
        },
      },
    ],
  };
}
