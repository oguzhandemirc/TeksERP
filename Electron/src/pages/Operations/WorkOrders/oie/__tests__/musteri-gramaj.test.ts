// S3 (fabrika cevabı 14): belgeden İE formunda müşterinin varsayılan kurşun gramajı ön seçilir; elle seçim ezilmez.
import { describe, expect, it } from "vitest";
import { initialDocDraft, reseedOwnerGramaj, applyPatch } from "../docDraft";

const OPTIONS = [{ id: "v25" }, { id: "v50", isDefault: true }];
const note = (ownerCustomerId: string | null) => ({
  ownerCustomerId, ourBatchNo: null, ourBatchNoKey: null, kursunMeters: "100", kursunMetersSource: null, kursunMetersReview: false,
}) as unknown as Parameters<typeof initialDocDraft>[0];

describe("belgeden İE — müşteri varsayılan gramajı", () => {
  it("müşterili belge: müşterinin gramajı; varsayılansız müşteri / müşterisiz: istasyonunki", () => {
    expect(initialDocDraft(note("k1"), OPTIONS, { k1: "v25" }).gramajId).toBe("v25");
    expect(initialDocDraft(note("k2"), OPTIONS, { k1: "v25" }).gramajId).toBe("v50");
    expect(initialDocDraft(note(null), OPTIONS, { k1: "v25" }).gramajId).toBe("v50");
    expect(initialDocDraft(note("k1"), OPTIONS).gramajId).toBe("v50");
  });
  it("kurşunsuz rota (seçenek yok): müşteri varsayılanı da ön seçilmez", () => {
    expect(initialDocDraft(note("k1"), [], { k1: "v25" }).gramajId).toBeNull();
  });
  it("müşteri değişince yeniden ön seçilir; elle seçimden sonra değişmez", () => {
    const d0 = initialDocDraft(note(null), OPTIONS, { k1: "v25" });
    const d1 = reseedOwnerGramaj(d0, applyPatch(d0, { ownerCustomerId: "k1" }), OPTIONS, { k1: "v25" });
    expect(d1.gramajId).toBe("v25");
    const touched = { ...d1, gramajId: "v50", gramajTouched: true };
    const d2 = reseedOwnerGramaj(touched, applyPatch(touched, { ownerCustomerId: "k3" }), OPTIONS, { k3: "v25" });
    expect(d2.gramajId).toBe("v50");
  });
});
