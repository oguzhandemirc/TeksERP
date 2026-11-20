// İplik hareketi "Kaynak" etiketi: belgeden doğan satır "Elle giriş" görünmez (2026-11-20 devere E2E bulgusu).
import { describe, expect, it } from "vitest";
import { movementSource, type YarnMovementRow } from "./service";

const base: YarnMovementRow = {
  id: "m", kind: "SUBCONTRACT_OUT" as YarnMovementRow["kind"], qtyKg: "10", reason: null, createdAt: "2026-11-20T10:00:00Z",
  goodsReceiptId: null, invoiceId: null, item: { id: "i", code: "IP", name: "İplik" }, warehouse: { id: "w", code: "D", name: "Depo" },
  user: null, goodsReceipt: null,
};

describe("movementSource", () => {
  it("devere sevki/iadesi: sipariş no + sevk no", () => {
    expect(movementSource({ ...base, dispatchItem: { dispatch: { dispatchNo: "FS2011260001", warpingOrder: { orderNo: "FDV2011260001" } } } }))
      .toBe("Devere FDV2011260001 · FS2011260001");
  });
  it("devere dışı fason sevki, emanet, levent, sayım", () => {
    expect(movementSource({ ...base, dispatchItem: { dispatch: { dispatchNo: "FS1", warpingOrder: null } } })).toBe("Fason sevki FS1");
    expect(movementSource({ ...base, consignmentItem: { dispatch: { dispatchNo: "ES1" } } })).toBe("Emanet sevki ES1");
    expect(movementSource({ ...base, warpBeam: { beamNo: "LV1" } })).toBe("Levent LV1");
    expect(movementSource({ ...base, stockCount: { countNo: "SY1" } })).toBe("Sayım SY1");
  });
  it("bağsız satır (ya da eski backend) hâlâ Elle giriş", () => {
    expect(movementSource(base)).toBe("Elle giriş");
  });
});
