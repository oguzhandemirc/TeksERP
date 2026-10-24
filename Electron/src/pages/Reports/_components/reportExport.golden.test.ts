// =============================================================================
// GERİYE UYUM ALTINI — `bloklar`sız (eski) spec'in PDF/Yazdır HTML'i ve Excel sayfaları
// R0-GRAFIK genişlemesinden ÖNCEKİ kodun çıktısıyla BAYT BAYT aynı kalır.
// Özetler genişlemeden önce ölçüldü (2026-10-24); değişirse `ReportExportBar` taşıyan 39 sayfanın
// kâğıdı sessizce değişmiş demektir. Negatif sonda: eski `@page` satırına tek boşluk
// eklendi → HTML testi 1 ❌ (Excel testi yeşil kalır — ayrım doğru).
// =============================================================================
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets, type ReportExportSpec } from "./reportExport";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const ESKI: ReportExportSpec = {
  title: "Kalite Karnesi",
  subtitle: "01.07.2026 – 31.07.2026",
  meta: ["Oranlar METRAJ ağırlıklıdır.", "Karşılaştırma dönemi: Haziran"],
  tables: [
    {
      name: "Kumaş Bazında",
      columns: [
        { header: "Kumaş", key: "label" },
        { header: "Toplam (m)", key: "totalQty", numFmt: "#,##0.0", align: "right" },
        { header: "1. Kalite %", key: "pct", numFmt: "0.0", align: "right" },
        { header: "Not", key: "not" },
      ],
      rows: [
        { label: "POPERMAN & SİMLİ <özel>", totalQty: 654, pct: 92, not: 1.25 },
        { label: "PANOS", totalQty: 222, pct: 9.9, not: "—" },
      ],
      totalRow: { label: "TOPLAM", totalQty: 876, pct: 71.1 },
      notes: ["Fire dahildir."],
    },
    { name: "İkinci", columns: [{ header: "A", key: "a" }], rows: [{ a: "x" }] },
  ],
};

const ALTIN = {
  dikey: "4604a9f250a7843c175f3320c4c068830f919016395fc44d787c6575eba2cca1",
  yatay: "f88b738d6d5fbd2ba287e835d2988194b78aea27a939f561a94a36d57bc808ae",
  sade: "663918f8666b8560470bd3d3eda18b6249b2e63f09084fe87794905912cdfa70",
  excel: "9946fc424d0d2771142a75aaccd79ea85ffe5ba6500f8a2f6fca500cafb3cd19",
};

describe("eski spec çıktısı bayt bayt aynı (bloklar yok)", () => {
  it("PDF/Yazdır HTML'i — dikey, yatay, alt başlıksız", () => {
    expect(sha(buildReportHtml(ESKI))).toBe(ALTIN.dikey);
    expect(sha(buildReportHtml({ ...ESKI, orientation: "landscape" }))).toBe(ALTIN.yatay);
    expect(sha(buildReportHtml({ title: "T", tables: [ESKI.tables[1]!] }))).toBe(ALTIN.sade);
  });

  it("Excel sayfaları", () => {
    expect(sha(JSON.stringify(toSheets(ESKI)))).toBe(ALTIN.excel);
  });
});
