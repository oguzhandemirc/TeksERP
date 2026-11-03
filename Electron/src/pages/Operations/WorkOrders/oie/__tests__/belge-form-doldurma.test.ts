// S16d: klasik iş emri formunda belge okut — okuma özeti → form kutuları (saf eşleme), "Belgeden" rozeti, form ucu gövdesi.
import { describe, expect, it } from "vitest";
import { applyReadSummary, docMarks, docNoteText, docTextHints, formEndpointExtras, mergeDocDraft, parseFormNumber, type ClassicPayloadPart, type DocReadSummary } from "../docFormFill";
import type { DocDraft } from "../docDraft";

const OPEN = { targetQuantityEnabled: true, itemLocked: false };
const SUMMARY: DocReadSummary = {
  formFields: { hedefMetraj: 4521.5, hedefKg: "1.234,5", en: "280", desenText: "TÜL 12", renkText: "KREM", not: "  Acil  " },
  suggestions: { targetItem: { id: "item-1", name: "Tül", code: "T1" }, targetColor: { id: "color-1", name: "Krem" } },
};
const EMPTY = { targetItemId: null, targetColorId: null, width: null, targetQuantity: null, targetWeight: null };

describe("applyReadSummary — özet → form", () => {
  it("boş forma bütün belge değerleri dolar (kumaş/renk öneriden, sayılar TR biçiminden)", () => {
    const r = applyReadSummary(EMPTY, {}, SUMMARY, OPEN);
    expect(r.patch).toEqual({ targetItemId: "item-1", targetColorId: "color-1", width: 280, targetQuantity: 4521.5, targetWeight: 1234.5 });
    expect(r.applied).toEqual(r.patch);
    expect(docNoteText(SUMMARY)).toBe("Acil");
  });

  it("hedef metraj kapalı kurulumda metraj/kg yazılmaz; sipariş bağlıyken kumaş/renk ezilmez", () => {
    expect(applyReadSummary(EMPTY, {}, SUMMARY, { targetQuantityEnabled: false, itemLocked: false }).patch).toEqual({ targetItemId: "item-1", targetColorId: "color-1", width: 280 });
    expect(applyReadSummary(EMPTY, {}, SUMMARY, { targetQuantityEnabled: true, itemLocked: true }).patch).toEqual({ width: 280, targetQuantity: 4521.5, targetWeight: 1234.5 });
  });

  it("kullanıcının doldurduğu kutu ezilmez", () => {
    const r = applyReadSummary({ ...EMPTY, width: "300" }, {}, SUMMARY, OPEN);
    expect(r.patch.width).toBeUndefined();
    expect(r.applied.width).toBeUndefined();
  });

  it("yeniden okuma: dokunulmamış belge değeri yenilenir, elle düzeltilen korunur, yeni belgede olmayan boşalır", () => {
    const first = applyReadSummary(EMPTY, {}, SUMMARY, OPEN);
    // Form şimdi belgeden dolu; kullanıcı yalnız eni düzeltti (kutu metni "290").
    const current = { ...first.patch, width: "290" };
    const second = applyReadSummary(current, first.applied, { formFields: { hedefMetraj: 5000 }, suggestions: {} }, OPEN);
    expect(second.patch).toEqual({ targetQuantity: 5000, targetItemId: null, targetColorId: null, targetWeight: null });
    expect(second.applied).toEqual({ targetQuantity: 5000 });
  });

  it("eski sunucu (formFields/suggestions/tanitim yok) → hiçbir kutuya dokunulmaz", () => {
    expect(applyReadSummary(EMPTY, {}, { state: "READ" }, OPEN)).toEqual({ patch: {}, applied: {} });
    expect(applyReadSummary(EMPTY, {}, undefined, OPEN)).toEqual({ patch: {}, applied: {} });
    expect(docTextHints({ state: "READ" })).toEqual({ desen: null, renk: null });
  });

  it("katalog önerisi yoksa okunan desen/renk yazısı ipucu olur", () => {
    expect(docTextHints({ formFields: SUMMARY.formFields })).toEqual({ desen: "TÜL 12", renk: "KREM" });
    expect(docTextHints(SUMMARY)).toEqual({ desen: null, renk: null });
  });
});

describe("docMarks — Belgeden rozeti", () => {
  it("değer belgedekiyle aynıyken rozet var; elle düzeltilince kalkar", () => {
    const { applied } = applyReadSummary(EMPTY, {}, SUMMARY, OPEN);
    // Sayı kutusu metin taşır ("280" = 280).
    const filled = { targetItemId: "item-1", targetColorId: "color-1", width: "280", targetQuantity: "4521.5", targetWeight: 1234.5 };
    expect([...docMarks(filled, applied)].sort()).toEqual(["targetColorId", "targetItemId", "targetQuantity", "targetWeight", "width"]);
    const edited = { ...filled, width: "281", targetColorId: "color-2" };
    expect(docMarks(edited, applied).has("width")).toBe(false);
    expect(docMarks(edited, applied).has("targetColorId")).toBe(false);
    expect(docMarks(edited, applied).has("targetQuantity")).toBe(true);
  });

  it("parseFormNumber: TR biçimi, sıfır ve çöp", () => {
    expect(parseFormNumber("1.234,5")).toBe(1234.5);
    expect(parseFormNumber("0")).toBeNull();
    expect(parseFormNumber("abc")).toBeNull();
  });
});

const PAYLOAD: ClassicPayloadPart = {
  targetItemId: "item-1", targetColorId: "color-1", width: 280, targetQuantity: 4500, targetWeight: 1200,
  plannedStartDate: "2026-11-05T05:00:00.000Z", plannedEndDate: null, foldType: "2-KAT", orderLineIds: [],
};

describe("formEndpointExtras — S16a form ucu gövdesi", () => {
  it("tek iş emri: dolu alanlar gider, boşlar hiç gitmez", () => {
    expect(formEndpointExtras(PAYLOAD, false)).toEqual({
      targetItemId: "item-1", targetColorId: "color-1", width: 280, targetQuantity: 4500, targetWeight: 1200,
      plannedStartDate: "2026-11-05T05:00:00.000Z", foldType: "2-KAT",
    });
  });

  it("her partiye ayrı iş emri (PER_PARTY): hedef metraj ve kg GÖNDERİLMEZ (sunucu 400)", () => {
    const b = formEndpointExtras({ ...PAYLOAD, orderLineIds: ["l1"] }, true);
    expect(b).not.toHaveProperty("targetQuantity");
    expect(b).not.toHaveProperty("targetWeight");
    expect(b.orderLineIds).toEqual(["l1"]);
  });

  it("boş form → boş ek gövde (sunucu bugünkü varsayılanları uygular)", () => {
    expect(formEndpointExtras({ targetItemId: null, targetColorId: null, width: null, targetQuantity: null, targetWeight: null, plannedStartDate: null, plannedEndDate: null, foldType: null }, false)).toEqual({});
  });
});

describe("mergeDocDraft — tanıtma sonrası yeniden okuma", () => {
  const base: DocDraft = { ownerCustomerId: null, ownerFromDoc: false, ourBatchNo: null, ourBatchNoKey: null, meters: null, metersSource: null, metersReview: false, gramajId: null, notes: "" };
  const fresh: DocDraft = { ...base, ownerCustomerId: "c-1", ownerFromDoc: true, ourBatchNo: "P-7", ourBatchNoKey: "k1", meters: 4521.5, metersSource: "OUTPUT" };

  it("boş kutular yeni okumadan dolar", () => {
    expect(mergeDocDraft(base, fresh, "Acil")).toMatchObject({ ownerCustomerId: "c-1", ownerFromDoc: true, ourBatchNo: "P-7", meters: 4521.5, notes: "Acil" });
  });

  it("kullanıcının seçtiği müşteri, metre ve notu korunur", () => {
    const mine = { ...base, ownerCustomerId: "c-9", meters: 100, metersSource: "MANUAL" as const, notes: "benim" };
    expect(mergeDocDraft(mine, fresh, "Acil")).toMatchObject({ ownerCustomerId: "c-9", meters: 100, metersSource: "MANUAL", notes: "benim", ourBatchNo: "P-7" });
  });
});
