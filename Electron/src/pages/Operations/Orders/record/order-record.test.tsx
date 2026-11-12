import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { visibleOrderTabs } from "./order-record-tabs";
import { mergeOrderMovements, type OrderMovement } from "./order-movements";
import { orderMetreFigures, orderStatusChip } from "./order-record";
import type { OrderAccess } from "./useOrderRecordData";
import type { Order } from "../types";

vi.mock("@/components/ui/stat-card", () => ({ StatCard: ({ label, value }: { label: ReactNode; value: ReactNode }) => <div>{label}: {value}</div> }));
const { orderStatCards } = await import("./OrderGeneralTab");

const open: OrderAccess = { write: true, workOrders: true, weaving: true, shipments: true, documents: true, history: true, production: true };
const counts = { lines: 2, workOrders: 1, weaving: 2, shipments: 3, documents: 1 };
const keys = (a: OrderAccess, c = counts) => visibleOrderTabs(a, c).map((t) => t.key);

describe("visibleOrderTabs — kapı + veri", () => {
  it("hepsi açık ve dolu: altı sekme, sayı rozetleri; Geçmiş'te sayı yok", () => {
    const tabs = visibleOrderTabs(open, counts);
    expect(tabs.map((t) => t.key)).toEqual(["genel", "kalemler", "uretim", "sevkiyatlar", "belgeler", "gecmis"]);
    expect(tabs.find((t) => t.key === "uretim")?.count).toBe(3);
    expect(tabs.find((t) => t.key === "gecmis")?.count).toBeNull();
  });

  it("boş sekme gizli: sevkiyat/belge/üretim yoksa ya da yükleniyorsa çizilmez", () => {
    expect(keys(open, { lines: 2, workOrders: 0, weaving: 0, shipments: 0, documents: undefined })).toEqual(["genel", "kalemler", "gecmis"]);
  });

  it("izin/modül kapısı: üretim rejimi kapalıysa Üretim yok; belge/geçmiş izni yoksa o sekmeler yok", () => {
    expect(keys({ ...open, production: false })).not.toContain("uretim");
    expect(keys({ ...open, documents: false, history: false })).toEqual(["genel", "kalemler", "uretim", "sevkiyatlar"]);
    expect(keys({ ...open, weaving: false }, { ...counts, workOrders: 0 })).not.toContain("uretim");
  });
});

const baseOrder = (over: Partial<Order> = {}) =>
  ({ id: "o", status: "PARTIAL_SHIPPED", shippedQty: 250, manualClosedById: null, currency: "USD", totalAmount: "1234567.8", lines: [{ id: "l", quantity: 1000, unit: "MT", cancelledAt: null, shippedQty: 250 }], ...over }) as unknown as Order;

describe("sayı kartları ve durum", () => {
  it("metre ayırıcısız, tutar siparişin kendi para birimiyle binlik ayırıcılı; termin/gecikme kartı yok", () => {
    render(<div>{orderStatCards(baseOrder(), true)}</div>);
    expect(screen.getByText(/İstenen: 1000 m/)).toBeTruthy();
    expect(screen.getByText(/Kalan: 750 m/)).toBeTruthy();
    expect(screen.getByText(/Tutar: 1\.234\.567,80 USD/)).toBeTruthy();
    expect(screen.queryByText(/gecik|gün kaldı|gün geçti|termin/i)).toBeNull();
  });

  it("fiyat kapalı ya da tutar yoksa Tutar kartı yok; ölçülü kalem yoksa metre kartı yok", () => {
    expect(orderStatCards(baseOrder(), false)).toHaveLength(3);
    expect(orderStatCards(baseOrder({ totalAmount: null }), true)).toHaveLength(3);
    const kg = baseOrder({ totalAmount: null, lines: [{ id: "l", quantity: 5, unit: "KG", cancelledAt: null }] as Order["lines"] });
    expect(orderMetreFigures(kg)).toBeNull();
    expect(orderStatCards(kg, true)).toHaveLength(0);
  });

  it("durum çipi miktar parantezini atar; iptal gül tonunda", () => {
    expect(orderStatusChip(baseOrder()).label).not.toMatch(/\(/);
    expect(orderStatusChip(baseOrder({ status: "CANCELLED" })).tone).toBe("rose");
  });
});

describe("mergeOrderMovements", () => {
  const m = (key: string, at: string | null): OrderMovement => ({ key, kind: "k", tone: "blue", docNo: key, sub: null, amount: null, at, to: null });
  it("en yeni önce, tarihsizler sonda, sınır uygulanır", () => {
    const out = mergeOrderMovements([[m("a", "2026-11-01"), m("x", null)], [m("b", "2026-11-05")]], 3).map((x) => x.key);
    expect(out).toEqual(["b", "a", "x"]);
    expect(mergeOrderMovements([[m("a", "2026-11-01"), m("b", "2026-11-02")]], 1)).toHaveLength(1);
  });
});
