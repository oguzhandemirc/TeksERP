// Özel dokuma şablonu saf dönüşümleri + terbiye seçici atlanma kuralı (İE ayrımı 2026-11-23).
// Negatif sonda: `templateToPreset`te IN_HOUSE fasoncu süzgeci kaldırılınca "içeride + fasoncu" kırmızı;
// `terbiyeSeciciGosterilir`den `|| canNewShortcut` kaldırılınca "yeni özel kartı seçiciyi gösterir" kırmızı.
import { describe, expect, it } from "vitest";
import { terbiyeSeciciGosterilir } from "@/pages/Operations/WorkOrders/oie/secici-kural";
import { weavingOrderFormDefaults } from "../schema";
import { applyPreset, orderTemplates, templateFormSchema, templateHint, templatePayload, templateToFormValues, templateToPreset } from "./preset";
import type { WeavingOrderTemplate } from "./types";

const base: WeavingOrderTemplate = {
  id: "t1", name: "Fason dokuma", description: null, itemId: null, executionKind: null, subcontractorId: null,
  plannedM: null, notes: null, sortOrder: 0, isActive: true,
};
const KIND = { IN_HOUSE: "Kendi tezgahımızda", SUBCONTRACTED: "Fasonda dokunuyor" };

describe("templateToPreset / applyPreset", () => {
  it("boş şablon → boş ön-dolgu → formun varsayılanı aynen", () => {
    expect(templateToPreset(base)).toEqual({});
    expect(applyPreset(templateToPreset(base))).toEqual(weavingOrderFormDefaults);
    expect(applyPreset(null)).toEqual(weavingOrderFormDefaults);
  });
  it("⭐ dolu alanlar taşınır; Decimal metni sayıya normalize ('1200.000' → '1200')", () => {
    const p = templateToPreset({ ...base, itemId: "i1", executionKind: "SUBCONTRACTED", subcontractorId: "s1", plannedM: "1200.000", notes: "Tahar 4" });
    expect(p).toEqual({ itemId: "i1", executionKind: "SUBCONTRACTED", subcontractorId: "s1", plannedM: "1200", notes: "Tahar 4" });
    const v = applyPreset(p);
    expect(v).toMatchObject({ itemId: "i1", executionKind: "SUBCONTRACTED", subcontractorId: "s1", plannedM: "1200", notes: "Tahar 4" });
    expect(v.orderLines).toEqual([]);
  });
  it("⭐ içeride + fasoncu (eski/bozuk satır): fasoncu taşınmaz — form XOR'u ihlal edilmez", () => {
    expect(templateToPreset({ ...base, executionKind: "IN_HOUSE", subcontractorId: "s1" })).toEqual({ executionKind: "IN_HOUSE" });
    expect(applyPreset({ executionKind: "IN_HOUSE", subcontractorId: "s1" }).subcontractorId).toBe("");
  });
  it("tür boş + fasoncu dolu → fasonda sayılır", () => {
    expect(templateToPreset({ ...base, subcontractorId: "s1" })).toEqual({ executionKind: "SUBCONTRACTED", subcontractorId: "s1" });
  });
  it("sıfır/negatif metre taşınmaz", () => {
    expect(templateToPreset({ ...base, plannedM: 0 })).toEqual({});
  });
});

describe("şablon formu", () => {
  it("⭐ gövde: boş → null, metin metre virgüllü sayıya, içeride ise fasoncu düşer, sıra boş → 0", () => {
    const body = templatePayload({ name: " Fason ", description: "", itemId: "", executionKind: "IN_HOUSE", subcontractorId: "s1", plannedM: "1250,5", notes: " ", sortOrder: "" });
    expect(body).toEqual({ name: "Fason", description: null, itemId: null, executionKind: "IN_HOUSE", subcontractorId: null, plannedM: 1250.5, notes: null, sortOrder: 0 });
    expect(templatePayload({ ...templateToFormValues(null), name: "X", executionKind: "" }).executionKind).toBeNull();
  });
  it("gidiş-dönüş: şablon → form değerleri → gövde aynı alanları üretir", () => {
    const t = { ...base, itemId: "i1", executionKind: "SUBCONTRACTED" as const, subcontractorId: "s1", plannedM: "900.000", sortOrder: 3 };
    expect(templatePayload(templateToFormValues(t))).toMatchObject({ itemId: "i1", executionKind: "SUBCONTRACTED", subcontractorId: "s1", plannedM: 900, sortOrder: 3 });
  });
  it("şema: ad zorunlu, içeride + fasoncu reddedilir, metre > 0", () => {
    const ok = { ...templateToFormValues(null), name: "A" };
    expect(templateFormSchema.safeParse(ok).success).toBe(true);
    expect(templateFormSchema.safeParse({ ...ok, name: " " }).success).toBe(false);
    expect(templateFormSchema.safeParse({ ...ok, executionKind: "IN_HOUSE", subcontractorId: "s1" }).success).toBe(false);
    expect(templateFormSchema.safeParse({ ...ok, plannedM: "0" }).success).toBe(false);
    expect(templateFormSchema.safeParse({ ...ok, sortOrder: "1.5" }).success).toBe(false);
  });
});

describe("seçici sırası ve ipucu", () => {
  it("sortOrder küçük önce, eşitlikte Türkçe ad; pasif düşer", () => {
    const list = [
      { ...base, id: "a", name: "Şile", sortOrder: 1 },
      { ...base, id: "b", name: "Çorlu", sortOrder: 1 },
      { ...base, id: "c", name: "Zeta", sortOrder: 0 },
      { ...base, id: "d", name: "Pasif", sortOrder: 0, isActive: false },
    ];
    expect(orderTemplates(list).map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
  it("ipucu: kumaş · fasoncu/tür · metre; yoksa açıklama, o da yoksa genel", () => {
    expect(templateHint({ ...base, item: { id: "i", code: "K1", name: "Tül 280" }, executionKind: "IN_HOUSE", plannedM: "1500" }, KIND)).toBe("Tül 280 · Kendi tezgahımızda · 1500 m");
    expect(templateHint({ ...base, subcontractor: { id: "s", code: "F", name: "Ayhan" }, executionKind: "SUBCONTRACTED" }, KIND)).toBe("Ayhan");
    expect(templateHint({ ...base, description: "Haftalık" }, KIND)).toBe("Haftalık");
    expect(templateHint(base, KIND)).toBe("Ön-dolu dokuma iş emri");
  });
});

describe("terbiye seçici atlanma kuralı", () => {
  it("⭐ yeni özel kartı (izinli) seçiciyi gösterir; hiçbir özel seçenek yoksa atlanır", () => {
    expect(terbiyeSeciciGosterilir({ shortcutCount: 0, scanRoute: false, canNewShortcut: true })).toBe(true);
    expect(terbiyeSeciciGosterilir({ shortcutCount: 0, scanRoute: false, canNewShortcut: false })).toBe(false);
    expect(terbiyeSeciciGosterilir({ shortcutCount: 2, scanRoute: false, canNewShortcut: false })).toBe(true);
    expect(terbiyeSeciciGosterilir({ shortcutCount: 0, scanRoute: true, canNewShortcut: false })).toBe(true);
  });
});
