// İade kapsamı modeli (saf) — `returnScope.ts`
//   §1 dört giriş yolu tek modele iner; varsayılan seçim TÜMÜ
//   §2 aday sipariş = seçili topların HEPSİNE uyanlar; seçim boşsa aday yok
//   §3 özet: belge sayısı = seçili topu olan grup sayısı (sevkiyat başına bir belge)
//   §4 sipariş geçerliliği ve toplu yük: yalnız seçili grup, sipariş grup başına
//   §5 kaynak metni: `useReturnEntry` tek/çoklu grubu ayırır (create ↔ createBatch); kutu SVK'yı
//      sevkiyat kapsamı olarak çözer; pencere çipleri çizer
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allRollIds, autoOrders, buildBatchPayload, candidateOrders, ordersValid, scopeFromLot, scopeFromRoll, scopeFromSack, scopeFromShipment, summarize,
} from "./returnScope";
import type { ReturnLookupRoll, ReturnScopeGroup } from "./service";

const roll = (id: string, qty = 10): ReturnLookupRoll => ({ id, barcode: `T${id}`, item: null, color: null, width: null, currentQty: qty, qualityGrade: "A", qualityGradeRef: null });
const group = (shipmentId: string, rolls: ReturnLookupRoll[], orders: { id: string; rollIds: string[] }[]): ReturnScopeGroup => ({
  shipment: { id: shipmentId, shipmentNo: `SVK-${shipmentId}`, dispatchedAt: null },
  customer: null, branch: null,
  sacks: [{ id: `s-${shipmentId}`, sackNo: `CV-${shipmentId}`, packageNo: 1, packingGroupName: null, rolls }],
  orders: orders.map((o) => ({ ...o, orderNumber: `O-${o.id}`, status: "APPROVED", deadline: null })),
});

describe("iade kapsamı", () => {
  const gA = group("A", [roll("a1"), roll("a2", 20)], [{ id: "oA", rollIds: ["a1"] }, { id: "oAll", rollIds: ["a1", "a2"] }]);
  const gB = group("B", [roll("b1")], []);
  const lot = scopeFromLot({ lot: { id: "L", name: "SP-3" }, customer: null, groups: [gA, gB], returnGradingEnabled: false });

  it("§1 dört yol tek model, varsayılan tümü", () => {
    expect(scopeFromRoll({ roll: roll("r"), shipment: null, customer: null, branch: null, candidateOrders: [{ id: "o", orderNumber: "O", status: "APPROVED", deadline: null }], returnGradingEnabled: false }).groups[0]!.orders[0]!.rollIds).toEqual(["r"]);
    expect(scopeFromSack({ sack: { id: "s", sackNo: "CV1" }, shipment: { id: "S", shipmentNo: "SVK1", dispatchedAt: null }, customer: null, branch: null, rolls: [roll("x"), roll("y")], candidateOrders: [], returnGradingEnabled: true }).groups[0]!.sacks[0]!.rolls).toHaveLength(2);
    expect(scopeFromShipment({ ...gA, returnGradingEnabled: false }).groups).toHaveLength(1);
    expect([...allRollIds(lot)].sort()).toEqual(["a1", "a2", "b1"]);
    expect(lot.label).toBe("SP-3");
  });

  it("§2 aday sipariş seçili topların hepsine uyar", () => {
    expect(candidateOrders(gA, new Set(["a1"])).map((o) => o.id)).toEqual(["oA", "oAll"]);
    expect(candidateOrders(gA, new Set(["a1", "a2"])).map((o) => o.id)).toEqual(["oAll"]);
    expect(candidateOrders(gA, new Set())).toEqual([]);
    expect(autoOrders(lot, new Set(["a1", "a2", "b1"])).get("A")).toBe("oAll");
    expect(autoOrders(lot, new Set(["a1"])).get("A")).toBeNull(); // iki aday → kullanıcı seçer
  });

  it("§3 özet: belge = seçili topu olan grup", () => {
    expect(summarize(lot, new Set(["a1", "a2", "b1"]))).toEqual({ rollCount: 3, meters: 40, docCount: 2 });
    expect(summarize(lot, new Set(["a2"]))).toEqual({ rollCount: 1, meters: 20, docCount: 1 });
    expect(summarize(lot, new Set()).docCount).toBe(0);
  });

  it("§4 sipariş geçerliliği + toplu yük", () => {
    const sel = new Set(["a1", "a2", "b1"]);
    expect(ordersValid(lot, sel, new Map([["A", null]]))).toBe(false); // A'da aday var, seçilmemiş
    expect(ordersValid(lot, sel, new Map([["A", "oAll"]]))).toBe(true); // B'de aday yok → siparişsiz
    expect(ordersValid(lot, sel, new Map([["A", "oA"]]))).toBe(false); // oA a2'ye uymaz
    const payload = buildBatchPayload(lot, new Set(["a2", "b1"]), new Map([["A", "oAll"]]), { reasonId: "r", reasonText: null, note: null, qualityGradeId: null });
    expect(payload.groups).toEqual([{ rollIds: ["a2"], orderId: "oAll" }, { rollIds: ["b1"], orderId: null }]);
    expect(buildBatchPayload(lot, new Set(["b1"]), new Map(), { reasonId: null, reasonText: "x", note: null, qualityGradeId: null }).groups).toHaveLength(1);
  });

  it("§5 kaynak metni: tek grup → create, çok grup → createBatch", () => {
    const hook = readFileSync(join(__dirname, "useReturnEntry.ts"), "utf-8");
    expect(hook).toMatch(/payload\.groups\.length === 1/);
    expect(hook).toMatch(/returnsService\.create\(/);
    expect(hook).toMatch(/returnsService\.createBatch\(/);
    const dialog = readFileSync(join(__dirname, "ReturnEntryDialog.tsx"), "utf-8");
    expect(dialog).toMatch(/summary\.docCount/);
    // Okutan hiç seçmez: tek kutu ön ekten çözer (ROLL/SACK/SHIPMENT), çipler seçici + gösterge.
    expect(hook).toMatch(/kind === "SHIPMENT"/);
    expect(dialog).toMatch(/<ReturnScopeChips/);
  });
});
