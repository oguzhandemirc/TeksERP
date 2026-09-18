// =============================================================================
// BEKÇİ — rapor istemcisi: sayfanın `params`ı = isteğin querystring'i (2026-09-18, d9 L4 bulgusu)
// =============================================================================
//   §1 TABLO: `reportsClient.get` kullanan 18 uçta eksen anahtarları (customerId · destination · itemId · colorId ·
//      subcontractorId · reasonCode) querystring'e YAZILIR — eskiden yalnız tarih/karşılaştırma yazılıyor, eksenler düşüyordu
//   §2 boş/undefined değer yazılmaz; tarih + karşılaştırma anahtarları aynen; parametresiz istek querystring'siz
//   NEGATİF SONDA: `getReport` eski allowlist'e (yalnız dateFrom/dateTo/compare*) dönerse §1 18 ❌
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
import { reportsClient } from "./reportsClient";

/** `reportsClient.get` çağıran her uç (grep 2026-09-18) — yeni uç bu listeye eklenir; eksen taşımayan uç da anahtarı düşürmemeli. */
const UCLAR = [
  "sales/order-cancellation", "sales/order-intake", "sales/demand-analysis", "sales/shipment-scorecard", "sales/order-leadtime", "sales/return-scorecard",
  "quality/scorecard", "quality/scrap-scorecard", "quality/plan-deviation-scorecard",
  "subcontract/scorecard", "audit/system-log-summary", "audit/user-activity",
  "production/station-efficiency", "production/operator-performance", "production/machine-usage", "production/scrap", "production/wip",
  "customer/scorecard",
] as const;

beforeEach(() => { get.mockReset().mockResolvedValue({ data: { success: true, data: {}, range: { from: "", to: "" } } }); });

describe("reportsClient.get — eksenler querystring'e iner", () => {
  it.each(UCLAR)("§1 ⭐ %s: customerId · destination · itemId · colorId · subcontractorId · reasonCode istekte", async (path) => {
    await reportsClient.get(path, { dateFrom: "2026-09-01", dateTo: "2026-09-18", customerId: "c1,c2", destination: "EXPORT", itemId: "i1", colorId: "r1", subcontractorId: "f1", reasonCode: "MUSTERI_VAZGECTI" });
    const url = String(get.mock.calls[0]![0]);
    expect(url.startsWith(`/api/reports/${path}?`)).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-18", customerId: "c1,c2", destination: "EXPORT", itemId: "i1", colorId: "r1", subcontractorId: "f1", reasonCode: "MUSTERI_VAZGECTI" });
  });

  it("§2 boş/undefined yazılmaz; compare üçlüsü aynen; parametresiz → querystring yok", async () => {
    await reportsClient.get("sales/order-intake", { dateFrom: "2026-09-01", dateTo: "2026-09-18", compare: "prev", compareFrom: "2026-08-01", compareTo: "2026-08-18", customerId: "", itemId: undefined });
    expect(String(get.mock.calls[0]![0])).toBe("/api/reports/sales/order-intake?dateFrom=2026-09-01&dateTo=2026-09-18&compare=prev&compareFrom=2026-08-01&compareTo=2026-08-18");
    await reportsClient.get("production/wip");
    expect(String(get.mock.calls[1]![0])).toBe("/api/reports/production/wip");
  });
});
