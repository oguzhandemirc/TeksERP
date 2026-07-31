import { describe, expect, it } from "vitest";
import { reorderWithinStation } from "./queue-reorder";
import type { KursunQueueItem } from "./types";

function item(
  id: string,
  stationName: string,
  overrides: Partial<KursunQueueItem> = {},
): KursunQueueItem {
  return {
    workOrderStepId: id,
    stationName,
    workOrderId: `wo-${id}`,
    batchNumber: `P-${id}`,
    travelerCardNumber: null,
    travelerCardBarcode: null,
    itemName: null,
    colorName: null,
    colorHex: null,
    openRollCount: 1,
    totalCurrentQty: 100,
    oldestEnteredAt: null,
    priority: 0,
    isUrgent: false,
    urgentMarkedAt: null,
    ...overrides,
  };
}

const ids = (list: KursunQueueItem[]) => list.map((i) => i.workOrderStepId);

describe("reorderWithinStation", () => {
  it("aynı satıra bırakınca hiçbir şey yapmaz", () => {
    const items = [item("a", "Kurşun 1"), item("b", "Kurşun 1")];
    expect(reorderWithinStation(items, "Kurşun 1", "a", "a")).toBeNull();
  });

  it("gruba ait olmayan id ile null döner", () => {
    const items = [item("a", "Kurşun 1"), item("b", "Kurşun 2")];
    expect(reorderWithinStation(items, "Kurşun 1", "a", "b")).toBeNull();
  });

  it("grup içinde sıralar ve DİĞER istasyonların satırlarını yerinde bırakır", () => {
    // Düz liste istasyonlara göre bloklu DEĞİL — backend acil/öncelik sırasıyla
    // döndüğü için satırlar iç içe geçebilir. Bu durumda bile yalnız o
    // istasyonun işgal ettiği pozisyonlar yeniden yazılmalı.
    const items = [
      item("a1", "Kurşun 1"),
      item("b1", "Kurşun 2"),
      item("a2", "Kurşun 1"),
      item("b2", "Kurşun 2"),
      item("a3", "Kurşun 1"),
    ];

    const res = reorderWithinStation(items, "Kurşun 1", "a3", "a1");
    expect(res).not.toBeNull();
    // a3 en üste taşındı; Kurşun 2 satırları 2. ve 4. sırada kaldı.
    expect(ids(res!.next)).toEqual(["a3", "b1", "a1", "b2", "a2"]);
  });

  it("priority'yi GRUP İÇİ index'ten üretir", () => {
    const items = [
      item("a1", "Kurşun 1"),
      item("b1", "Kurşun 2"),
      item("a2", "Kurşun 1"),
    ];

    const res = reorderWithinStation(items, "Kurşun 1", "a2", "a1");
    expect(res!.payload).toEqual([
      { id: "a2", priority: 0 },
      { id: "a1", priority: 10 },
    ]);
  });

  it("acil satırları payload'a KOYMAZ (backend onları üste pinler)", () => {
    const items = [
      item("u", "Kurşun 1", { isUrgent: true }),
      item("a", "Kurşun 1"),
      item("b", "Kurşun 1"),
    ];

    const res = reorderWithinStation(items, "Kurşun 1", "b", "a");
    expect(ids(res!.next)).toEqual(["u", "b", "a"]);
    expect(res!.payload).toEqual([
      { id: "b", priority: 0 },
      { id: "a", priority: 10 },
    ]);
  });

  it("grupta yalnız acil satır varsa payload boş kalır", () => {
    const items = [
      item("u1", "Kurşun 1", { isUrgent: true }),
      item("u2", "Kurşun 1", { isUrgent: true }),
    ];

    const res = reorderWithinStation(items, "Kurşun 1", "u2", "u1");
    expect(ids(res!.next)).toEqual(["u2", "u1"]);
    expect(res!.payload).toEqual([]);
  });
});
