// =============================================================================
// BEKÇİ — Fasondaki İplik: fasoncu ekstresi spec'i (iç sütun OPT-IN) · lot seçenek kaynağı (faceted, katalog süzgeci
// uca gitmez) · satır eyleminin tutma kalemi eşleşmesi (iplik + lot + sahip, > 0)
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YarnAtSubRow } from "./service";
import type { WarpingYarnHolding } from "../WarpingOrders/holding-types";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (url: string) => get(url) } }));

import { buildSubcontractorStatement } from "./statementExport";
import { yarnAtSubLotOptions } from "./service";
import { matchingHoldings } from "./RowActionHost";

const base: YarnAtSubRow = {
  subcontractorId: "s1", subcontractorCode: "DV1", subcontractorName: "Alfa Devere", yarnItemId: "y1", yarnItemCode: "PES50", yarnItemName: "PES 50 denye",
  lotId: "l1", lotNo: "LOT-77", ownerCustomerId: "c1", ownerCustomerName: "Müşteri Tekstil", kg: "10.000", oldestDispatchedAt: "2026-10-01T08:00:00Z",
  orders: [{ warpingOrderId: "o1", orderNo: "FDV0001", status: "COMPLETED", kg: "10.000" }],
};
const rows: YarnAtSubRow[] = [
  { ...base, priceStatus: "PRICE", unitPrice: "2.9000", currency: "USD", value: "29.00" },
  { ...base, lotId: "l2", lotNo: "LOT-78", ownerCustomerId: null, ownerCustomerName: null, kg: "5.000", priceStatus: "MIXED_CURRENCY", unitPrice: null, currency: null, value: null },
];

describe("fasoncu ekstresi spec'i", () => {
  it("varsayılan: Sahibi ve Değer sütunları YOK (belge fasoncuya gidebilir)", () => {
    const spec = buildSubcontractorStatement(rows, { includeOwner: false, includeValue: false })!;
    const keys = spec.tables[0]!.columns.map((c) => c.key);
    expect(keys).not.toContain("owner");
    expect(keys).not.toContain("value");
    expect(keys).not.toContain("unitPrice");
    expect(spec.title).toContain("Alfa Devere");
    expect(spec.tables[0]!.totalRow).toMatchObject({ kg: 15 });
    expect(spec.tables[0]!.rows[0]).toMatchObject({ orders: "FDV0001 (devreden)" });
    expect(JSON.stringify(spec)).not.toContain("Müşteri Tekstil");
    expect(JSON.stringify(spec)).not.toContain("29");
  });
  it("opt-in: değer sütunları + para birimi başına toplam + fiyatsız satır notu", () => {
    const spec = buildSubcontractorStatement(rows, { includeOwner: true, includeValue: true })!;
    const t = spec.tables[0]!;
    expect(t.columns.map((c) => c.key)).toEqual(expect.arrayContaining(["owner", "unitPrice", "value", "currency"]));
    expect(t.notes?.join(" ")).toMatch(/Toplam değer \(USD\): 29,00/);
    expect(t.notes?.join(" ")).toMatch(/1 satırda fiyat yok/);
    expect(spec.orientation).toBe("landscape");
  });
  it("boş küme → spec yok", () => {
    expect(buildSubcontractorStatement([], { includeOwner: false, includeValue: false })).toBeNull();
  });
});

describe("lot seçenek kaynağı", () => {
  // Aynı lot iki fasoncuda (tekilleşmeli) + lotsuz satır (seçenek olmamalı).
  const withDupes: YarnAtSubRow[] = [...rows, { ...base, subcontractorId: "s2" }, { ...base, lotId: null, lotNo: null }];
  beforeEach(() => get.mockReset().mockResolvedValue({ data: { success: true, data: withDupes } }));
  it("kendi anahtarı hariç süzgeçler + arama uca; katalog süzgeci (isActive) GİTMEZ; tekil lotlar", async () => {
    const src = yarnAtSubLotOptions({ subcontractorId: "s1", status: "COMPLETED" });
    const r = await src.getAll({ search: "LOT" });
    const url = decodeURIComponent(String(get.mock.calls[0]![0]));
    expect(url).toContain("filter[subcontractorId]=s1");
    expect(url).toContain("filter[status]=COMPLETED");
    expect(url).toContain("search=LOT");
    expect(url).not.toContain("isActive");
    expect(url).not.toContain("lotId");
    expect(r.data.map((d) => d.id)).toEqual(["l1", "l2"]);
    expect(r.data[0]).toMatchObject({ name: "LOT-77", code: "PES 50 denye" });
  });
});

describe("satır eylemi — tutma kalemi eşleşmesi", () => {
  const h = (p: Partial<WarpingYarnHolding>): WarpingYarnHolding => ({
    dispatchItemId: "d1", dispatchId: "x", dispatchNo: "FS1", dispatchedAt: "2026-10-01T08:00:00Z", ownWarpingOrderId: "o1", own: true,
    yarnItemId: "y1", lotId: "l1", lotNo: "LOT-77", ownerCustomerId: "c1", outKg: "10", returnedKg: "0", transferInKg: "0", transferOutKg: "0", holdingKg: "10.000", ...p,
  });
  it("aynı iplik + lot + sahip ve tutma > 0", () => {
    const list = [h({}), h({ dispatchItemId: "d2", lotId: "l2" }), h({ dispatchItemId: "d3", holdingKg: "0.000" }), h({ dispatchItemId: "d4", ownerCustomerId: null }), h({ dispatchItemId: "d5", yarnItemId: "y2" })];
    expect(matchingHoldings(list, base).map((x) => x.dispatchItemId)).toEqual(["d1"]);
    expect(matchingHoldings([h({ lotId: null, ownerCustomerId: null })], { yarnItemId: "y1", lotId: null, ownerCustomerId: null })).toHaveLength(1);
  });
});
