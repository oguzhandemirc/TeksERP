// BEKÇİ — fatura ↔ mal kabul fişleri (saf): etiket · tetik metni · küme eşitliği · fark satırı · yalnız AŞAN satır banda
import { describe, expect, it } from "vitest";
import type { InvoiceReceiptDifference } from "./service";
import { differenceText, exceededDifferences, receiptLabel, receiptsTriggerText, sameIdSet } from "./invoiceReceipts";

const diff = (p: Partial<InvoiceReceiptDifference>): InvoiceReceiptDifference =>
  ({ kind: "QTY", invoice: 1250, receipts: 1200, diffPct: 4.2, tolerancePct: 2, exceeded: true, ...p });

describe("invoiceReceipts", () => {
  it("etiket: fiş no + irsaliye; irsaliye yoksa yalnız fiş no", () => {
    expect(receiptLabel({ receiptNo: "MK-1", deliveryNoteNo: "4471" })).toBe("MK-1 · irsaliye 4471");
    expect(receiptLabel({ receiptNo: "MK-1", deliveryNoteNo: null })).toBe("MK-1");
  });

  it("tetik metni 'Ad: Değer' kalıbı; cari yoksa liste kurulamaz", () => {
    expect(receiptsTriggerText(0, false)).toBe("Önce cari seç");
    expect(receiptsTriggerText(0, true)).toBe("Mal kabul fişleri: yok");
    expect(receiptsTriggerText(3, true)).toBe("Mal kabul fişleri: 3 seçili");
  });

  it("küme eşitliği sıradan bağımsız; değişen küme farklı", () => {
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
    expect(sameIdSet([], [])).toBe(true);
  });

  it("fark satırı: miktar sayı, tutar para; yüzdeler tr", () => {
    expect(differenceText(diff({}), "TRY")).toBe("Miktar: fatura 1.250 ↔ fişler 1.200 (fark %4,2 · tolerans %2)");
    expect(differenceText(diff({ kind: "AMOUNT", invoice: 1000, receipts: 900, diffPct: 11.11, tolerancePct: 0 }), "TRY")).toMatch(/^Tutar: fatura .*1\.000.* ↔ fişler .*900.* \(fark %11,1 · tolerans %0\)$/);
  });

  it("⭐ banda yalnız toleransı AŞAN satır girer; kontrol kapalı/fişsiz → boş", () => {
    const match = { checked: true, qtyTolerancePct: 2, priceTolerancePct: 2, differences: [diff({}), diff({ kind: "AMOUNT", exceeded: false })] };
    expect(exceededDifferences(match).map((d) => d.kind)).toEqual(["QTY"]);
    expect(exceededDifferences({ ...match, differences: match.differences.map((d) => ({ ...d, exceeded: false })) })).toEqual([]);
    expect(exceededDifferences(null)).toEqual([]);
    expect(exceededDifferences(undefined)).toEqual([]);
  });
});
