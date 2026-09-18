// =============================================================================
// BEKÇİ — Fiş yazınca sipariş sorguları BAYATLAMAZ (kullanıcı bulgusu 2026-09-18: kapanan sipariş seçicide kaldı, kalemler
// yeniden doldu) + otomatik doldurma yalnız TAZE veriyle
// =============================================================================
// Negatif sonda: `RECEIPT_SIDE_EFFECT_KEYS`ten `purchase-orders` düşürülünce ① ❌; `shouldAutoFill`den `!isFetching`
// kalkınca ③ ❌.
import { describe, expect, it, vi } from "vitest";
import { RECEIPT_SIDE_EFFECT_KEYS, invalidateReceiptSideEffects } from "./receiptInvalidation";
import { shouldAutoFill } from "../PurchaseOrders/GoodsReceiptOrderSection";

vi.mock("@/hooks/useWarehouses", () => ({ WAREHOUSES_QUERY_KEY: ["warehouses"] }));

describe("mal kabul yan etkileri — sipariş sorguları", () => {
  it("① ⭐ sipariş üçlüsü (liste/seçici · detay/bekleyen · açık kalemler) listede; eski dörtlü de duruyor", () => {
    const keys = RECEIPT_SIDE_EFFECT_KEYS.map((k) => k[0]);
    for (const k of ["purchase-orders", "purchase-order", "purchase-order-open-lines", "goods-receipts", "rolls", "yarn", "warehouses"]) expect(keys).toContain(k);
  });

  it("② her anahtar için invalidateQueries çağrılır (tek liste, üç çağıran)", () => {
    const invalidateQueries = vi.fn();
    invalidateReceiptSideEffects({ invalidateQueries } as never);
    expect(invalidateQueries).toHaveBeenCalledTimes(RECEIPT_SIDE_EFFECT_KEYS.length);
    expect(invalidateQueries.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0])).toContain("purchase-orders");
  });
});

describe("shouldAutoFill — otomatik doldurma yalnız TAZE veriyle", () => {
  it("③ ⭐ detay hâlâ çekiliyorken (önbellekteki fiş-öncesi kalan) DOLDURMAZ; fetch bitince doldurur; aynı sipariş ikinci kez doldurmaz", () => {
    expect(shouldAutoFill({ poId: "po-1", disabled: false, isFetching: true, filledFor: null })).toBe(false);
    expect(shouldAutoFill({ poId: "po-1", disabled: false, isFetching: false, filledFor: null })).toBe(true);
    expect(shouldAutoFill({ poId: "po-1", disabled: false, isFetching: false, filledFor: "po-1" })).toBe(false);
    expect(shouldAutoFill({ poId: "po-2", disabled: false, isFetching: false, filledFor: "po-1" })).toBe(true);
  });
  it("sipariş yok ya da form kilitli → doldurmaz", () => {
    expect(shouldAutoFill({ poId: null, disabled: false, isFetching: false, filledFor: null })).toBe(false);
    expect(shouldAutoFill({ poId: "po-1", disabled: true, isFetching: false, filledFor: null })).toBe(false);
  });
});
