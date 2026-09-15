// =============================================================================
// RAPOR KAPISI — saf yüklemler (Raporlar K5): fail-closed iki yönlü
// =============================================================================
// Negatif sondalar (bir kezlik, geri alındı — sha commit mesajında): `isReportOpenWith`
// `null`de `true` döndürüldü → §2 ❌; bilinmeyen anahtar kontrolü kaldırıldı → §3 ❌.
// =============================================================================
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { categoryHasOpenReport, isReportOpenWith, reportKeyOfPath } from "./report-gate";

const AKEY = REPORT_CATALOG.find((r) => r.panelYolu !== "")!.key;

describe("report-gate", () => {
  it("§1 yol → anahtar: yaprak çözülür, kategori hub'ı ve rapor-dışı yol null, parametre segmenti düşer", () => {
    expect(reportKeyOfPath("/reports/sales/order-intake")).toBe("sales/order-intake");
    expect(reportKeyOfPath("/reports/production/batch-trace/:batchId")).toBe("production/batch-trace");
    expect(reportKeyOfPath("reports/finance/aging?asOf=2026-01-01".split("?")[0]!)).toBe("finance/aging");
    expect(reportKeyOfPath("/reports/sales")).toBeNull();
    expect(reportKeyOfPath("/reports")).toBeNull();
    expect(reportKeyOfPath("/operations/work-orders/abc")).toBeNull();
  });

  it("§2 liste OKUNAMADI (null) ⇒ her rapor KAPALI — boş liste ile aynı şey değil", () => {
    expect(isReportOpenWith(null, AKEY)).toBe(false);
    expect(isReportOpenWith([], AKEY)).toBe(true);
    expect(categoryHasOpenReport(null, AKEY.split("/")[0]!)).toBe(false);
  });

  it("§3 katalogda olmayan anahtar KAPALI; listedeki anahtar KAPALI; diğerleri AÇIK", () => {
    expect(isReportOpenWith([], "sales/yok-boyle-rapor")).toBe(false);
    expect(isReportOpenWith([AKEY], AKEY)).toBe(false);
    const other = REPORT_CATALOG.find((r) => r.key !== AKEY)!.key;
    expect(isReportOpenWith([AKEY], other)).toBe(true);
  });

  it("§4 kategori: tüm raporları kapalıysa karo yok, biri açıksa var", () => {
    const cat = "sales";
    const all = REPORT_CATALOG.filter((r) => r.key.startsWith(`${cat}/`)).map((r) => r.key);
    expect(all.length).toBeGreaterThan(1); // körlük zemini
    expect(categoryHasOpenReport(all, cat)).toBe(false);
    expect(categoryHasOpenReport(all.slice(1), cat)).toBe(true);
    expect(categoryHasOpenReport([], "yok-kategori")).toBe(false);
  });
});
