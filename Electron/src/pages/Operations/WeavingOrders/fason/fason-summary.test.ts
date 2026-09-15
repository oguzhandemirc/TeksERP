import { describe, expect, it } from "vitest";
import { EMPTY_ROW, dispatchMeters, isFasonSectionVisible, kgSourceLabel, openYarnItems, openYarnReturns, rowToPayload, validateReceiptRow, yarnLineToPayload } from "./fason-summary";
import type { FasonDispatch, FasonYarnItem } from "./types";

const d: FasonDispatch = {
  id: "d1",
  dispatchNo: "FS-1",
  dispatchedAt: "2026-09-14T10:00:00.000Z",
  cancelledAt: null,
  plateNumber: null,
  driverName: null,
  items: [
    { warpBeam: { id: "b1", beamNo: "L-1", status: "SHIPPED_OUT" }, events: [{ kind: "SHIP_OUT", lengthM: 1000 }] },
    { warpBeam: { id: "b2", beamNo: "L-2", status: "READY" }, events: [{ kind: "SHIP_OUT", lengthM: 800 }, { kind: "RETURNED_IN", lengthM: 30 }] },
  ],
};

describe("fason-summary (G2p)", () => {
  it("⭐ Fason bölümü yalnız fasonda dokunan işte çizilir", () => {
    expect(isFasonSectionVisible({ executionKind: "SUBCONTRACTED" })).toBe(true);
    expect(isFasonSectionVisible({ executionKind: "IN_HOUSE" })).toBe(false);
  });
  it("sevk metreleri: SHIP_OUT toplanır, RETURNED_IN ayrı toplanır, iptal olay yok sayılır", () => {
    expect(dispatchMeters(d)).toEqual({ sentM: 1800, returnedM: 30 });
    expect(dispatchMeters({ ...d, items: [] })).toEqual({ sentM: 0, returnedM: 0 });
  });
  it("⭐ makbuz satırı: metre zorunlu ve pozitif; en/kg boş serbest, negatif red; kalite ≤ 16", () => {
    expect(validateReceiptRow({ ...EMPTY_ROW, initialQty: "480" }).ok).toBe(true);
    expect(validateReceiptRow(EMPTY_ROW).ok).toBe(false);
    expect(validateReceiptRow({ ...EMPTY_ROW, initialQty: "0" }).ok).toBe(false);
    expect(validateReceiptRow({ ...EMPTY_ROW, initialQty: "10", width: "-1" }).ok).toBe(false);
    expect(validateReceiptRow({ ...EMPTY_ROW, initialQty: "10", qualityGrade: "x".repeat(17) }).ok).toBe(false);
  });
  it("satır → gövde: boş = null (\"0\" ≠ girilmedi), renk boş = işin rengi (null)", () => {
    expect(rowToPayload({ initialQty: "480", width: "", weightKg: "0", qualityGrade: " A ", colorId: null })).toEqual({
      initialQty: 480,
      width: null,
      weightKg: 0,
      qualityGrade: "A",
      colorId: null,
    });
    expect(rowToPayload({ ...EMPTY_ROW, initialQty: "1", colorId: "c1" }).colorId).toBe("c1");
  });
});

const yarnItem = (over: Partial<FasonYarnItem> = {}): FasonYarnItem => ({
  dispatchItemId: "y1", unit: "KG", item: { id: "i1", code: "IP-1", name: "iplik" }, warehouseId: "w1", lotId: null,
  dispatchedKg: 60, returnedKg: 0, sarilanKg: 0, sarilan: [], remainingKg: 60, returns: [], ...over,
});

describe("fason iplik (G1p)", () => {
  it("⭐ yarnLineToPayload — geçersiz satır null (sessiz düşme yok): kalem/depo/kg eksik ya da kg ≤ 0", () => {
    expect(yarnLineToPayload({ itemId: null, warehouseId: "w1", lotId: "", qtyKg: "5" })).toBeNull();
    expect(yarnLineToPayload({ itemId: "i1", warehouseId: "", lotId: "", qtyKg: "5" })).toBeNull();
    expect(yarnLineToPayload({ itemId: "i1", warehouseId: "w1", lotId: "", qtyKg: "0" })).toBeNull();
    expect(yarnLineToPayload({ itemId: "i1", warehouseId: "w1", lotId: "", qtyKg: "abc" })).toBeNull();
  });
  it("yarnLineToPayload — Zod ile birebir: lot boş → null, kg sayı", () => {
    expect(yarnLineToPayload({ itemId: "i1", warehouseId: "w1", lotId: "", qtyKg: "12.5" })).toEqual({ itemId: "i1", warehouseId: "w1", lotId: null, qtyKg: 12.5 });
    expect(yarnLineToPayload({ itemId: "i1", warehouseId: "w1", lotId: "l1", qtyKg: "3" })).toEqual({ itemId: "i1", warehouseId: "w1", lotId: "l1", qtyKg: 3 });
  });
  it("openYarnItems — yalnız fasonda kalanı olan kalemler; eski backend (yarnItems yok) boş", () => {
    const withYarn: FasonDispatch = { ...d, yarnItems: [yarnItem(), yarnItem({ dispatchItemId: "y2", remainingKg: 0 })] };
    expect(openYarnItems(withYarn).map((x) => x.dispatchItemId)).toEqual(["y1"]);
    expect(openYarnItems(d)).toEqual([]);
  });
  it("⭐ openYarnReturns — storno edilmiş dönüş listelenmez (grup net'i), açık olan listelenir", () => {
    const it = yarnItem({
      returns: [
        { movementId: "r1", kind: "SUBCONTRACT_RETURN", qtyKg: 20, warehouseId: "w1", lotId: null, reasonCode: "KALAN_IPLIK" },
        { movementId: "c1", kind: "SUBCONTRACT_RETURN_CANCEL", qtyKg: 20, warehouseId: "w1", lotId: null, reasonCode: "KALAN_IPLIK" },
        { movementId: "r2", kind: "SUBCONTRACT_RETURN", qtyKg: 15, warehouseId: "w2", lotId: null, reasonCode: "KALITE" },
      ],
    });
    expect(openYarnReturns(it).map((r) => r.movementId)).toEqual(["r2"]);
  });
  it("kgSourceLabel — kaynak beyanı gizlenmez", () => {
    expect(kgSourceLabel("THEORETICAL")).toBe("nominal (hesap)");
    expect(kgSourceLabel("WEIGHED")).toBe("tartıldı");
    expect(kgSourceLabel("KARMA")).toBe("karma (hesap + tartı)");
    expect(kgSourceLabel(null)).toBe("—");
  });
});
