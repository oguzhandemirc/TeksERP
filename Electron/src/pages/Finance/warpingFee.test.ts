import { describe, expect, it } from "vitest";
import { buildUpdateBody } from "./invoiceForm";
import { feeText } from "@/pages/Operations/WarpingOrders/order-model";
import {
  differenceText, feePriceText, isLumpPrice, orderCheckState, preselectOrders, priceDecimals, selectedExpected, toggleOrder,
  type WarpingFeeMatch, type WarpingFeeOrder,
} from "./warpingFee";

const rc = (key: string, invoice: string | null, amount = "100.00", selectable?: boolean) => ({
  receiptKey: key, deliveryNoteNo: key, receivedAt: "2026-11-20T08:00:00.000Z", beamCount: 2, lengthM: "2000.000", qty: "2000.000",
  expectedAmount: amount, invoice: invoice ? { id: invoice, docNo: `FT-${invoice}`, status: "DRAFT" } : null, ...(selectable === undefined ? {} : { selectable }),
});
const order = (id: string, receipts: WarpingFeeOrder["receipts"], fee: Partial<WarpingFeeOrder["fee"]> = {}): WarpingFeeOrder => ({
  id, orderNo: `DS-${id}`, status: "IN_PROGRESS", warpSpecName: "Tül", subcontractor: { id: "s", name: "Devereci" },
  fee: { unit: "METRE", unitPrice: "0.05", currency: "USD", ...fee }, receipts, totals: { lengthM: "0", qty: "0", expectedAmount: null }, invoiceState: "NONE",
});

describe("devere faturası saf katmanı", () => {
  it("8 ondalık fiyat: hane sayısı, götürü eşiği ve gösterim", () => {
    expect(priceDecimals("0.00001250")).toBe(7);
    expect(isLumpPrice("0.0500")).toBe(false);
    expect(isLumpPrice("0.00001250")).toBe(true);
    expect(feePriceText({ unit: "ENDS_METRE", unitPrice: "0.00001250", currency: "USD" })).toBe("0,0000125 USD / tel×m");
    expect(feeText({ unit: "ENDS_METRE", unitPrice: "0.00001250", currency: "USD" })).toBe("0,0000125 USD / tel×m");
  });

  it("sipariş satırı yalnız seçilebilir kabulleri ekler/çıkarır; başka faturalı kabul kilitli", () => {
    const o = order("1", [rc("a", null), rc("b", "x", "50.00", false), rc("c", null)]);
    expect(toggleOrder(o, [])).toEqual(["a", "c"]);
    expect(orderCheckState(o, new Set(["a"]))).toBe("some");
    expect(orderCheckState(o, new Set(["a", "c"]))).toBe("all");
    expect(toggleOrder(o, ["a", "c", "z"])).toEqual(["z"]);
    expect(preselectOrders([o, order("2", [rc("d", null)])], ["1"])).toEqual(["a", "c"]);
  });

  it("seçili beklenen toplam döviz başına; fiyatsız sipariş işaretlenir", () => {
    const os = [order("1", [rc("a", null, "0.10"), rc("b", null, "0.20")]), order("2", [rc("c", null)], { currency: "EUR" }), order("3", [rc("d", null)], { unitPrice: null, currency: null })];
    const s = selectedExpected(os, ["a", "b", "c", "d"]);
    expect(s.byCurrency).toEqual([{ currency: "USD", amount: 0.3 }, { currency: "EUR", amount: 100 }]);
    expect(s.missingPrice).toBe(true);
    expect(s.orderCount).toBe(3);
  });

  it("fark metni: işaretli tutar, döviz uyuşmazlığı nedeni", () => {
    const m = { currency: "USD", difference: "26.00", diffPct: "4.61", currencyMismatch: false, missingPrice: false } as WarpingFeeMatch;
    expect(differenceText(m)).toMatch(/^Fark \+26,00 .* \(%4,6\)$/);
    expect(differenceText({ ...m, currencyMismatch: true })).toMatch(/para biriminde/);
  });

  it("PATCH gövdesi devere kümesini yalnız değişince taşır", () => {
    const base = { lines: [], dueDate: "", externalNo: "", notes: "" };
    expect(buildUpdateBody({ ...base, warpingReceiptKeys: ["a"], initialWarpingReceiptKeys: ["a"] })).not.toHaveProperty("warpingReceiptKeys");
    expect(buildUpdateBody({ ...base, warpingReceiptKeys: [], initialWarpingReceiptKeys: ["a"] }).warpingReceiptKeys).toEqual([]);
  });
});
