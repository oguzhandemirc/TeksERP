import { describe, expect, it } from "vitest";
import { EMPTY_ROW, dispatchMeters, isFasonSectionVisible, rowToPayload, validateReceiptRow } from "./fason-summary";
import type { FasonDispatch } from "./types";

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
