import { describe, expect, it } from "vitest";
import { applyGroupOrder, reorderRows } from "./queue-reorder";
import type { KursunDistributionWaitingRow } from "./types";

function row(
  id: string,
  overrides: Partial<KursunDistributionWaitingRow> = {},
): KursunDistributionWaitingRow {
  return {
    workOrderStepId: id,
    workOrderId: `wo-${id}`,
    workOrderNumber: `IE-${id}`,
    batchNumbers: [`P-${id}`],
    travelerCardNumber: null,
    travelerCardBarcode: null,
    itemName: null,
    colorName: null,
    colorHex: null,
    openRollCount: 1,
    totalMeters: 100,
    oldestEnteredAt: null,
    isUrgent: false,
    urgentMarkedAt: null,
    isLastStep: false,
    eligible: true,
    blockReason: null,
    ...overrides,
  };
}

const ids = (list: KursunDistributionWaitingRow[]) =>
  list.map((i) => i.workOrderStepId);

describe("reorderRows", () => {
  it("aynı satıra bırakınca hiçbir şey yapmaz", () => {
    const items = [row("a"), row("b")];
    expect(reorderRows(items, "a", "a")).toBeNull();
  });

  it("listede olmayan id ile null döner", () => {
    const items = [row("a"), row("b")];
    expect(reorderRows(items, "a", "yok")).toBeNull();
  });

  it("düz listede satırı taşır", () => {
    const items = [row("a"), row("b"), row("c")];

    const res = reorderRows(items, "c", "a");
    expect(res).not.toBeNull();
    expect(ids(res!.next)).toEqual(["c", "a", "b"]);
  });

  it("priority'yi liste index'inden üretir", () => {
    const items = [row("a"), row("b"), row("c")];

    const res = reorderRows(items, "c", "a");
    expect(res!.payload).toEqual([
      { id: "c", priority: 0 },
      { id: "a", priority: 10 },
      { id: "b", priority: 20 },
    ]);
  });

  it("acil satırları payload'a KOYMAZ (backend onları üste pinler)", () => {
    const items = [row("u", { isUrgent: true }), row("a"), row("b")];

    const res = reorderRows(items, "b", "a");
    expect(ids(res!.next)).toEqual(["u", "b", "a"]);
    expect(res!.payload).toEqual([
      { id: "b", priority: 0 },
      { id: "a", priority: 10 },
    ]);
  });

  it("listede yalnız acil satır varsa payload boş kalır", () => {
    const items = [row("u1", { isUrgent: true }), row("u2", { isUrgent: true })];

    const res = reorderRows(items, "u2", "u1");
    expect(ids(res!.next)).toEqual(["u2", "u1"]);
    expect(res!.payload).toEqual([]);
  });

  it("dağıtıma UYGUN OLMAYAN satır da sıralanabilir", () => {
    // "Uygun değil" = bypass'a verilemez (tablette işlenecek) demektir; kuyrukta
    // bekliyor olması değişmez, dolayısıyla sırası da anlamlıdır. Sürüklemeyi
    // uygunluğa bağlamak, tablet rejimindeki işleri önceliklendirilemez yapardı.
    const items = [
      row("a"),
      row("b", { eligible: false, blockReason: "Bu adımda KK2 kaydı var" }),
    ];

    const res = reorderRows(items, "b", "a");
    expect(ids(res!.next)).toEqual(["b", "a"]);
    expect(res!.payload).toEqual([
      { id: "b", priority: 0 },
      { id: "a", priority: 10 },
    ]);
  });
});

/**
 * MAKİNE İÇİ sıra, dağıtılmışların DÜZ listesine geri örülür. Bu fonksiyonun
 * koruduğu şey ince: bir makinenin içini düzenlemek DİĞER makinelerin satırlarını
 * da, GRUPLARIN ekrandaki sırasını da oynatmamalı.
 */
describe("applyGroupOrder", () => {
  type Row = { workOrderStepId: string; machineId: string };
  const r = (id: string, machineId: string): Row => ({ workOrderStepId: id, machineId });
  const ids = (l: Row[]) => l.map((x) => x.workOrderStepId);

  it("yalnız hedef makinenin satırlarını, bulundukları slotlara yeni sırayla koyar", () => {
    const all = [r("a1", "M1"), r("b1", "M2"), r("a2", "M1"), r("b2", "M2")];

    // M1 içinde a2 öne alındı → a1/a2 slotları (0 ve 2) sırayla a2, a1 olur.
    const out = applyGroupOrder(all, "M1", [r("a2", "M1"), r("a1", "M1")]);
    expect(ids(out)).toEqual(["a2", "b1", "a1", "b2"]);
  });

  it("diğer makinelerin satır NESNELERİNE dokunmaz (referans korunur)", () => {
    const b1 = r("b1", "M2");
    const all = [r("a1", "M1"), b1, r("a2", "M1")];

    const out = applyGroupOrder(all, "M1", [r("a2", "M1"), r("a1", "M1")]);
    expect(out[1]).toBe(b1);
  });

  it("grupların ekrandaki sırası DEĞİŞMEZ (ilk görülen makine kuralı)", () => {
    // Gruplama düz dizideki ilk görülme sırasına bakıyor: M1 önce, M2 sonra.
    // Yeniden örme bu ilk-görülme sırasını bozmamalı.
    const all = [r("a1", "M1"), r("a2", "M1"), r("b1", "M2")];

    const out = applyGroupOrder(all, "M1", [r("a2", "M1"), r("a1", "M1")]);
    const firstSeen = [...new Set(out.map((x) => x.machineId))];
    expect(firstSeen).toEqual(["M1", "M2"]);
  });

  it("hedef makinede satır yoksa liste aynen döner", () => {
    const all = [r("b1", "M2")];
    expect(ids(applyGroupOrder(all, "M1", []))).toEqual(["b1"]);
  });

  it("eksik yeni sıra gelirse satır SAYISI korunur (ulaşılamaz dal, savunmacı)", () => {
    // `reorderRows` her zaman grubun tamamını döndürür → bu dala pratikte
    // girilmez. Yine de davranış kilitli: kuyruk tükenince slot ESKİ satırıyla
    // dolar. Satır düşürmek (["a2"]) iyimser state'ten bir işi YOK ederdi ve
    // sunucu yanıtı gelene kadar operatör onu göremezdi; tekrarlanan satır en
    // azından görünür bir tutarsızlıktır.
    const all = [r("a1", "M1"), r("a2", "M1")];

    const out = applyGroupOrder(all, "M1", [r("a2", "M1")]);
    expect(out).toHaveLength(2);
    expect(ids(out)).toEqual(["a2", "a2"]);
  });
});
