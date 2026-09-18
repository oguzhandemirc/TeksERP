// =============================================================================
// BEKÇİ — Z2 panel: dokuma işi ↔ sipariş satırı / levent ↔ dokuma işi gövdeleri (saf)
// =============================================================================
//   §1 `buildPayload.orderLines` küme REPLACE: boş dizi → [] (bağsız); tahsis "" → null; "120" → 120
//   §2 `toPlanPayload.weavingOrderId`: "" → null (serbest levent), id aynen
//   §3 seçici satırı → gösterim verisi: netOpenQty öncelikli, metin Decimal sayıya döner
//   §4 şema: tahsis "0" reddedilir ("0" bağ değil hata), boş geçer
// =============================================================================
import { describe, expect, it } from "vitest";
import { buildPayload } from "./useWeavingOrderMutations";
import { weavingOrderFormDefaults, weavingOrderFormSchema } from "./schema";
import { metaFromAvailable, metaFromLink } from "./WeavingOrderLinesSection";
import { toPlanPayload } from "../WarpBeams/usePageActions";
import { warpBeamPlanDefaults } from "../WarpBeams/schema";
import { buildWindPayload } from "../WarpBeams/WindDialog";
import type { AvailableOrderLine } from "@/pages/Operations/Orders/availableLines";

const line = (over: Partial<AvailableOrderLine> = {}): AvailableOrderLine => ({
  lineId: "l1", itemId: "i1", orderId: "o1", orderNumber: "SP-1", deadline: null, customerId: "c1", customerName: "ALFA", branchName: null,
  itemCode: "K1", itemName: "PATOS", customerItemName: null, colorId: null, colorCode: null, colorName: null, customerColorName: null,
  width: null, quantity: "500", openQty: "300", inProduction: "0", netOpenQty: "250", measured: true, hasWorkOrder: false, ...over,
});

describe("Z2 — dokuma işi sipariş satırı gövdesi", () => {
  it("§1 boş dizi → [] (bağsız); tahsis '' → null, '120' → 120", () => {
    expect(buildPayload({ ...weavingOrderFormDefaults, itemId: "i1" }).orderLines).toEqual([]);
    const p = buildPayload({ ...weavingOrderFormDefaults, itemId: "i1", orderLines: [{ orderLineId: "l1", allocatedM: "" }, { orderLineId: "l2", allocatedM: " 120 " }] });
    expect(p.orderLines).toEqual([{ orderLineId: "l1", allocatedM: null }, { orderLineId: "l2", allocatedM: 120 }]);
  });

  it("§4 şema: tahsis '0' reddedilir, boş geçer", () => {
    const base = { ...weavingOrderFormDefaults, itemId: "i1" };
    expect(weavingOrderFormSchema.safeParse({ ...base, orderLines: [{ orderLineId: "l1", allocatedM: "" }] }).success).toBe(true);
    const r = weavingOrderFormSchema.safeParse({ ...base, orderLines: [{ orderLineId: "l1", allocatedM: "0" }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Tahsis metresi sıfırdan büyük olmalı");
  });

  it("§3 seçici satırı → gösterim: netOpenQty öncelikli, Decimal metni sayı; ölçülmeyen 'ölçülmüyor'", () => {
    expect(metaFromAvailable(line())).toEqual({ orderNumber: "SP-1", customerName: "ALFA", itemName: "PATOS", colorName: null, qtyText: "250 m açık" });
    expect(metaFromAvailable(line({ netOpenQty: null, openQty: "300" })).qtyText).toBe("300 m açık");
    expect(metaFromAvailable(line({ netOpenQty: null, openQty: null, measured: false })).qtyText).toBe("ölçülmüyor");
  });

  it("§3b kayıtlı bağ (Z1 DTO) → gösterim: sipariş no · müşteri · açık = quantity − shippedQty; iptal satır işaretli", () => {
    const link = { id: "x", orderLineId: "l1", allocatedM: null, orderLine: { id: "l1", quantity: 500, shippedQty: 120, unit: "MT", cancelledAt: null, order: { id: "o1", orderNumber: "SP-1", customer: { id: "c1", name: "ALFA" } }, item: { id: "i1", code: "K1", name: "PATOS" } } };
    expect(metaFromLink(link)).toEqual({ orderNumber: "SP-1", customerName: "ALFA", itemName: "PATOS", colorName: null, qtyText: "380 m açık" });
    expect(metaFromLink({ ...link, orderLine: { ...link.orderLine, cancelledAt: "2026-09-18T00:00:00Z" } }).qtyText).toBe("satır iptal");
  });
});

describe("Z2 — levent dokuma işi bağı", () => {
  it("§2 '' → null (serbest levent), id aynen", () => {
    expect(toPlanPayload({ ...warpBeamPlanDefaults, warpSpecId: "w1", plannedLengthM: "100" }).weavingOrderId).toBeNull();
    expect(toPlanPayload({ ...warpBeamPlanDefaults, warpSpecId: "w1", plannedLengthM: "100", weavingOrderId: "wo1" }).weavingOrderId).toBe("wo1");
  });

  it("§2b sarım gövdesi: bağ '' → null, id aynen; adet 1 → raşel alanları gitmez", () => {
    const d = { lengthM: "100", kgSource: "WEIGHED" as const, inHouse: false, machineId: "", issues: [], returns: [], breakCount: "", clientToken: "t", weavingOrderId: "", count: "1", prefix: "" };
    expect(buildWindPayload(d)).toEqual({ lengthM: 100, kgSource: "WEIGHED", machineId: null, breakCount: null, clientToken: "t", weavingOrderId: null });
    expect(buildWindPayload({ ...d, weavingOrderId: "wo1" }).weavingOrderId).toBe("wo1");
  });
});
