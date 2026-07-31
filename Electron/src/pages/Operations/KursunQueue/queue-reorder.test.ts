import { describe, expect, it } from "vitest";
import { reorderQueue } from "./queue-reorder";
import type { KursunQueueItem } from "./types";

function item(id: string, overrides: Partial<KursunQueueItem> = {}): KursunQueueItem {
  return {
    workOrderStepId: id,
    // Fabrikada tek PROCESS_QC istasyonu var — her satırda AYNI ad; sıralama
    // bu alana BAKMAZ (gruplama yok).
    stationName: "Kurşun + KK2",
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
    bypassAssigned: false,
    bypassMachineName: null,
    ...overrides,
  };
}

const ids = (list: KursunQueueItem[]) => list.map((i) => i.workOrderStepId);

describe("reorderQueue", () => {
  it("aynı satıra bırakınca hiçbir şey yapmaz", () => {
    const items = [item("a"), item("b")];
    expect(reorderQueue(items, "a", "a")).toBeNull();
  });

  it("listede olmayan id ile null döner", () => {
    const items = [item("a"), item("b")];
    expect(reorderQueue(items, "a", "yok")).toBeNull();
  });

  it("düz listede satırı taşır", () => {
    const items = [item("a"), item("b"), item("c")];

    const res = reorderQueue(items, "c", "a");
    expect(res).not.toBeNull();
    expect(ids(res!.next)).toEqual(["c", "a", "b"]);
  });

  it("priority'yi liste index'inden üretir", () => {
    const items = [item("a"), item("b"), item("c")];

    const res = reorderQueue(items, "c", "a");
    expect(res!.payload).toEqual([
      { id: "c", priority: 0 },
      { id: "a", priority: 10 },
      { id: "b", priority: 20 },
    ]);
  });

  it("acil satırları payload'a KOYMAZ (backend onları üste pinler)", () => {
    const items = [item("u", { isUrgent: true }), item("a"), item("b")];

    const res = reorderQueue(items, "b", "a");
    expect(ids(res!.next)).toEqual(["u", "b", "a"]);
    expect(res!.payload).toEqual([
      { id: "b", priority: 0 },
      { id: "a", priority: 10 },
    ]);
  });

  it("listede yalnız acil satır varsa payload boş kalır", () => {
    const items = [item("u1", { isUrgent: true }), item("u2", { isUrgent: true })];

    const res = reorderQueue(items, "u2", "u1");
    expect(ids(res!.next)).toEqual(["u2", "u1"]);
    expect(res!.payload).toEqual([]);
  });

  it("bypass'a dağıtılmış satır da sıralanabilir (rozet sıralamayı kilitlemez)", () => {
    // Karışık rejim: bayrak yeni açıldı, bir kısım iş hâlâ tablet akışında.
    // Dağıtılmış satır kuyrukta KALIR (izleme) ve sırası değiştirilebilir.
    const items = [
      item("a"),
      item("b", { bypassAssigned: true, bypassMachineName: "Kurşun 2" }),
    ];

    const res = reorderQueue(items, "b", "a");
    expect(ids(res!.next)).toEqual(["b", "a"]);
    expect(res!.payload).toEqual([
      { id: "b", priority: 0 },
      { id: "a", priority: 10 },
    ]);
  });
});
