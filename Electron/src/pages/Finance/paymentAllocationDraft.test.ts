// BEKÇİ — ödeme girişinde açık fatura eşlemesi (saf): taslak → kalem · "Tümü" tutara uyar · FIFO önerisi · Tümünü kapat · kayıt kapısı
import { describe, expect, it } from "vitest";
import type { OpenInvoiceRow } from "./Allocations/service";
import { allocationBlockReason, allocationItems, draftItems, draftsCloseAll, draftsFromSuggestion, fillMaxDraft } from "./paymentAllocationDraft";

const row = (id: string, open: string, suggested?: string): OpenInvoiceRow =>
  ({ id, docNo: `F-${id}`, type: "SALES", currency: "TRY", issueDate: "2026-09-01", dueDate: null, effectiveDueDate: "2026-09-01", grandTotal: open, paidTotal: "0", openTotal: open, ...(suggested ? { suggested } : {}) }) as OpenInvoiceRow;
const ROWS = [row("a", "100.00"), row("b", "250.50")];

describe("paymentAllocationDraft", () => {
  it("taslak → pozitif kalemler (tablo sırası), kuruş; ondalık NOKTA (allocationMath sözleşmesi)", () => {
    expect(draftItems({ b: "250.50", a: "", c: "9" }, ROWS)).toEqual([{ invoiceId: "b", kurus: 25050 }]);
    expect(allocationItems([{ invoiceId: "b", kurus: 25050 }])).toEqual([{ invoiceId: "b", amount: "250.50" }]);
  });

  it("⭐ 'Tümü': tutar yazılmadıysa AÇIĞIN tamamı; yazıldıysa öteki satırlardan artan kadar", () => {
    expect(fillMaxDraft({}, ROWS, "b", 0)).toEqual({ b: "250.50" });
    expect(fillMaxDraft({ a: "100.00" }, ROWS, "b", 30000)).toEqual({ a: "100.00", b: "200.00" });
    expect(fillMaxDraft({ a: "100.00" }, ROWS, "b", 10000).b).toBe("");
  });

  it("FIFO önerisi sunucudan (`suggested`) taslağa; öneri yoksa boş", () => {
    expect(draftsFromSuggestion([row("a", "100.00", "100.00"), row("b", "250.50", "50.00")])).toEqual({ a: "100.00", b: "50.00" });
    expect(draftsFromSuggestion(ROWS)).toEqual({});
  });

  it("'Tümünü kapat': her açık fatura + toplam (tutar alanına)", () => {
    expect(draftsCloseAll(ROWS)).toEqual({ drafts: { a: "100.00", b: "250.50" }, totalKurus: 35050 });
  });

  it("⭐ kayıt kapısı: boş taslak serbest (bağsız ödeme) · eşlenen > tutar engel · satır açığını aşan engel", () => {
    expect(allocationBlockReason([], ROWS, 0)).toBeNull();
    expect(allocationBlockReason([{ invoiceId: "a", kurus: 10000 }], ROWS, 10000)).toBeNull();
    expect(allocationBlockReason([{ invoiceId: "a", kurus: 10000 }], ROWS, 5000)).toMatch(/aşıyor/);
    expect(allocationBlockReason([{ invoiceId: "a", kurus: 12000 }], ROWS, 20000)).toMatch(/açık tutarını aşıyor/);
  });
});
