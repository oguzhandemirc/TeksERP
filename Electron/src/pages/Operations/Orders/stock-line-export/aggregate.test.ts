// "Excel (stok kalemi bazında)" saf toplama — gruplama, birim ayrımı, iptal, açık<0, 0 tabanı, müşteri tekil.
import { describe, it, expect } from "vitest";
import type { Order, OrderLine } from "../types";
import { aggregateStockLines, type StockLineSources } from "./aggregate";
import { DEFAULT_STOCK_LINE_OPTIONS, type StockLineOptions } from "./options";

const KREP = { id: "i-krep", code: "K-1", name: "İPEK KREP" };
const SATEN = { id: "i-saten", code: "K-2", name: "SATEN" };
const EKRU = { id: "c-ekru", code: "R-1", name: "EKRU", hex: null };
const SIYAH = { id: "c-siyah", code: "R-2", name: "SİYAH", hex: null };

let seq = 0;
const line = (p: Partial<OrderLine> = {}): OrderLine =>
  ({
    id: `l${++seq}`,
    itemId: (p.item ?? KREP).id,
    colorId: (p.color === undefined ? EKRU : p.color)?.id ?? null,
    quantity: 100,
    unit: "MT",
    width: 150,
    unitPrice: null,
    customerItemName: null,
    customerColorName: null,
    cutNote: null,
    item: KREP,
    color: EKRU,
    shippedQty: 0,
    workOrderLinks: [],
    ...p,
  }) as OrderLine;

const order = (id: string, customer: string, lines: OrderLine[], p: Partial<Order> = {}): Order =>
  ({
    id,
    orderNumber: id,
    customerId: `m-${customer}`,
    customer: { id: `m-${customer}`, code: customer, name: customer },
    status: "APPROVED",
    deadline: null,
    lines,
    ...p,
  }) as Order;

const NO_SRC: StockLineSources = { stock: [], stockAll: [], liveMetersByWorkOrder: new Map() };
const opts = (p: Partial<StockLineOptions> = {}): StockLineOptions => ({ ...DEFAULT_STOCK_LINE_OPTIONS, ...p });
const wo = (id: string, status = "IN_PROGRESS") =>
  ({ workOrderId: id, workOrder: { id, workOrderNumber: id, status } }) as NonNullable<OrderLine["workOrderLinks"]>[number];

describe("aggregateStockLines", () => {
  it("üç müşteriden aynı kumaş+renk+en tek satır; müşteri tekil ve sıralı", () => {
    const r = aggregateStockLines(
      [
        order("o1", "Zeta", [line({ quantity: 100, shippedQty: 30 })]),
        order("o2", "Alfa", [line({ quantity: 200 }), line({ quantity: 50 })]),
        order("o3", "Alfa", [line({ quantity: 10 })]),
      ],
      opts(),
      NO_SRC,
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row).toMatchObject({ itemName: "İPEK KREP", colorName: "EKRU", width: 150, ordered: 360, shipped: 30, open: 330 });
    expect(row.customers).toEqual(["Alfa", "Zeta"]);
    expect(row.orderCount).toBe(3);
    expect(row.lineCount).toBe(4);
    expect(r).toMatchObject({ orderCount: 3, lineCount: 4 });
  });

  it("renk/en ayrımı kapatılınca o eksende toplanır", () => {
    const orders = [order("o1", "A", [line({ color: EKRU }), line({ color: SIYAH, colorId: SIYAH.id, width: 160 })])];
    expect(aggregateStockLines(orders, opts(), NO_SRC).rows).toHaveLength(2);
    const merged = aggregateStockLines(orders, opts({ byColor: false, byWidth: false }), NO_SRC).rows;
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ colorName: null, width: null, ordered: 200 });
  });

  it("birim her zaman ayrı: MT ile KG toplanmaz; KG'de sevk/açık ölçülmez; toplam birim başına", () => {
    const r = aggregateStockLines(
      [order("o1", "A", [line({ quantity: 100 }), line({ quantity: 40, unit: "KG", shippedQty: 5 })])],
      opts(),
      NO_SRC,
    );
    expect(r.rows.map((x) => x.unit).sort()).toEqual(["KG", "MT"]);
    const kg = r.rows.find((x) => x.unit === "KG")!;
    expect(kg).toMatchObject({ ordered: 40, shipped: null, open: null, inStock: null, toProduce: null });
    expect(r.totals.map((t) => t.unit).sort()).toEqual(["KG", "MT"]);
    expect(r.totals.find((t) => t.unit === "MT")?.ordered).toBe(100);
  });

  it("iptal kalem ve iptal sipariş hariç; elle kapanan siparişte açık 0", () => {
    const r = aggregateStockLines(
      [
        order("o1", "A", [line({ quantity: 100 }), line({ quantity: 999, cancelledAt: "2026-11-01T00:00:00Z" })]),
        order("o2", "B", [line({ quantity: 500 })], { status: "CANCELLED" }),
        order("o3", "C", [line({ quantity: 70, shippedQty: 20 })], { status: "COMPLETED" }),
      ],
      opts({ onlyOpen: false }),
      NO_SRC,
    );
    expect(r.rows[0]).toMatchObject({ ordered: 170, shipped: 20, open: 100 });
    expect(r.rows[0]!.customers).toEqual(["A", "C"]);
  });

  it("açık kalem başına 0'ın altına düşmez — fazla sevk başka müşterinin açığını yemez", () => {
    const r = aggregateStockLines(
      [order("o1", "A", [line({ quantity: 100, shippedQty: 180 })]), order("o2", "B", [line({ quantity: 50 })])],
      opts(),
      NO_SRC,
    );
    expect(r.rows[0]).toMatchObject({ shipped: 180, open: 50 });
  });

});

describe("aggregateStockLines — üretimde / depoda hazır / sıra", () => {
  it("üretilmesi gereken = açık − depo − üretimde, 0 tabanlı; stok kat/eksen toplanır", () => {
    const orders = [
      order("o1", "A", [line({ quantity: 1000, workOrderLinks: [wo("w1")] })]),
      order("o2", "B", [line({ item: SATEN, itemId: SATEN.id, quantity: 100, workOrderLinks: [wo("w2")] })]),
    ];
    const src: StockLineSources = {
      stock: [
        { itemId: KREP.id, colorId: EKRU.id, width: 150, qty: 200 }, // 2 kat
        { itemId: KREP.id, colorId: EKRU.id, width: 150, qty: 100 }, // tek kat
        { itemId: KREP.id, colorId: EKRU.id, width: 160, qty: 999 }, // başka en: eşleşmez
        { itemId: SATEN.id, colorId: EKRU.id, width: 150, qty: 80 },
      ],
      stockAll: [],
      liveMetersByWorkOrder: new Map([["w1", 250], ["w2", 90]]),
    };
    const rows = aggregateStockLines(orders, opts(), src).rows;
    expect(rows.find((x) => x.itemName === "İPEK KREP")).toMatchObject({ inStock: 300, inProduction: 250, toProduce: 450 });
    expect(rows.find((x) => x.itemName === "SATEN")).toMatchObject({ inStock: 80, inProduction: 90, toProduce: 0 });
  });

  it("aynı iş emri iki siparişe bağlıysa tek kez sayılır; iptal/devredilmiş İE sayılmaz", () => {
    const orders = [
      order("o1", "A", [line({ workOrderLinks: [wo("w1"), wo("wx", "CANCELLED"), wo("ws", "SUPERSEDED")] })]),
      order("o2", "B", [line({ workOrderLinks: [wo("w1")] })]),
    ];
    const live = new Map([["w1", 120], ["wx", 500], ["ws", 500]]);
    const r = aggregateStockLines(orders, opts(), { stock: [], stockAll: [], liveMetersByWorkOrder: live });
    expect(r.rows[0]?.inProduction).toBe(120);
  });

  it("ölçülemeyen kaynak: hücre boş ve üretilmesi gereken hesaplanmaz", () => {
    const r = aggregateStockLines([order("o1", "A", [line()])], opts(), {
      stock: null,
      stockAll: null,
      liveMetersByWorkOrder: new Map(),
    });
    expect(r.rows[0]).toMatchObject({ inStock: null, inStockAll: null, inProduction: 0, toProduce: null });
  });

  it("yalnız açığı olanlar süzgeci + açık çoktan aza sıra + en yakın termin yalnız açık kalemden", () => {
    const orders = [
      order("o1", "A", [line({ quantity: 100, shippedQty: 100 })], { deadline: "2026-11-01T00:00:00.000Z" }),
      order("o2", "B", [line({ item: SATEN, itemId: SATEN.id, quantity: 50 })], { deadline: "2026-12-01T00:00:00.000Z" }),
      order("o3", "C", [line({ item: SATEN, itemId: SATEN.id, quantity: 10 })], { deadline: "2026-11-20T00:00:00.000Z" }),
      order("o4", "D", [line({ color: SIYAH, colorId: SIYAH.id, quantity: 500 })]),
    ];
    const open = aggregateStockLines(orders, opts(), NO_SRC).rows;
    expect(open.map((x) => `${x.itemName}/${x.colorName}`)).toEqual(["İPEK KREP/SİYAH", "SATEN/EKRU"]);
    expect(open[1]?.nearestDeadline).toBe("2026-11-20T00:00:00.000Z");
    const all = aggregateStockLines(orders, opts({ onlyOpen: false }), NO_SRC).rows;
    expect(all).toHaveLength(3);
    expect(all.find((x) => x.itemName === "İPEK KREP" && x.colorName === "EKRU")?.nearestDeadline).toBeNull();
  });
});

describe("aggregateStockLines — depoda hazır (serbest) ↔ depoda (tümü)", () => {
  // Serbest kaynak (kalem ucu) çuvaldaki/sevke ayrılmış topu zaten içermez; tümü kaynağı (top listesi) içerir.
  const free = { itemId: KREP.id, colorId: EKRU.id, width: 150, qty: 120 };
  const inSack = { itemId: KREP.id, colorId: EKRU.id, width: "150.000" as unknown as number, qty: 70 };
  const onShipment = { itemId: KREP.id, colorId: EKRU.id, width: 150, qty: 30 };

  it("çuvaldaki ve sevkiyata ayrılmış top yalnız tümüye girer; üretilmesi gereken serbestle hesaplanır", () => {
    const r = aggregateStockLines([order("o1", "A", [line({ quantity: 1000 })])], opts(), {
      stock: [free],
      stockAll: [free, inSack, onShipment],
      liveMetersByWorkOrder: new Map(),
    });
    expect(r.rows[0]).toMatchObject({ inStock: 120, inStockAll: 220, toProduce: 880 });
    expect(r.totals[0]).toMatchObject({ inStock: 120, inStockAll: 220, toProduce: 880 });
  });

  it("tümü ölçülemediyse (seçilmedi / yetki yok) yalnız o hücre boş; serbest ve üretilecek etkilenmez", () => {
    const r = aggregateStockLines([order("o1", "A", [line({ quantity: 500 })])], opts(), {
      stock: [free],
      stockAll: null,
      liveMetersByWorkOrder: new Map(),
    });
    expect(r.rows[0]).toMatchObject({ inStock: 120, inStockAll: null, toProduce: 380 });
    expect(r.totals[0]?.inStockAll).toBeNull();
  });

  it("kg kalemde iki depo hücresi de boş", () => {
    const r = aggregateStockLines([order("o1", "A", [line({ unit: "KG" })])], opts(), {
      stock: [free],
      stockAll: [free, inSack],
      liveMetersByWorkOrder: new Map(),
    });
    expect(r.rows[0]).toMatchObject({ inStock: null, inStockAll: null });
  });
});
