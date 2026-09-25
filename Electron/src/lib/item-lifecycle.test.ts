// Ürün kartı yaşam döngüsü — panel saf katmanı (URUN-YASAM-DONGUSU.md §8).
// ⭐ Seçici kapsamı §4.1 ayarlarını izler; varsayılan = backend varsayılanı.
// ⭐ "Kullanımdan kaldır" seçenekleri: Pasif yalnız canlı kayıt 0 iken seçilebilir.
import { describe, expect, it } from "vitest";
import {
  defaultLifecycleChoice,
  foldRollsByStatus,
  itemLifecycleOf,
  lifecycleChoices,
  pickableLifecycle,
} from "./item-lifecycle";

describe("pickableLifecycle", () => {
  it("⭐ sipariş kalemi yalnız 'Serbest' ayarında Tükenene kadar kartı listeler", () => {
    expect(pickableLifecycle("order", undefined)).toBe("ACTIVE");
    expect(pickableLifecycle("order", { itemPhaseOutNewOrder: "OKUTULAN_TOPLAR" })).toBe("ACTIVE");
    expect(pickableLifecycle("order", { itemPhaseOutNewOrder: "KAPALI" })).toBe("ACTIVE");
    expect(pickableLifecycle("order", { itemPhaseOutNewOrder: "SERBEST" })).toBe("ACTIVE,PHASE_OUT");
  });
  it("⭐ üretim planı varsayılan açık (ayar yüklenmeden de), kapalıyken yalnız Aktif", () => {
    expect(pickableLifecycle("plan", undefined)).toBe("ACTIVE,PHASE_OUT");
    expect(pickableLifecycle("plan", { itemPhaseOutNewPlan: true })).toBe("ACTIVE,PHASE_OUT");
    expect(pickableLifecycle("plan", { itemPhaseOutNewPlan: false })).toBe("ACTIVE");
  });
  it("alış ve belgesiz stok girişi her ayarda yalnız Aktif", () => {
    const serbest = { itemPhaseOutNewOrder: "SERBEST" as const, itemPhaseOutNewPlan: true };
    expect(pickableLifecycle("purchase", serbest)).toBe("ACTIVE");
    expect(pickableLifecycle("stock", serbest)).toBe("ACTIVE");
  });
});

describe("lifecycleChoices", () => {
  it("⭐ Aktif kart: varsayılan Tükenene kadar; canlı kayıt varken Pasif kilitli ve sebebi yazılı", () => {
    const c = lifecycleChoices("ACTIVE", 3);
    expect(c.map((x) => x.to)).toEqual(["PHASE_OUT", "ARCHIVED"]);
    expect(c[1]!.blockedBy).toContain("3 canlı kayıt");
    expect(defaultLifecycleChoice(c)).toBe("PHASE_OUT");
  });
  it("⭐ Tükenene kadar kart: kalan 0 → varsayılan Pasif; kalan > 0 → Pasif kilitli, Aktif'e döndür seçilebilir", () => {
    expect(defaultLifecycleChoice(lifecycleChoices("PHASE_OUT", 0))).toBe("ARCHIVED");
    const c = lifecycleChoices("PHASE_OUT", 5);
    expect(c.find((x) => x.to === "ARCHIVED")!.blockedBy).not.toBeNull();
    expect(defaultLifecycleChoice(c)).toBe("ACTIVE");
  });
  it("Pasif kart diyalog seçeneği taşımaz (Aktifleştir satır düğmesidir)", () => {
    expect(lifecycleChoices("ARCHIVED", 0)).toEqual([]);
  });
});

describe("itemLifecycleOf / foldRollsByStatus", () => {
  it("eski sunucu (lifecycleStatus yok) isActive'ten türetilir", () => {
    expect(itemLifecycleOf({ isActive: true })).toBe("ACTIVE");
    expect(itemLifecycleOf({ isActive: false })).toBe("ARCHIVED");
    expect(itemLifecycleOf({ isActive: true, lifecycleStatus: "PHASE_OUT" })).toBe("PHASE_OUT");
  });
  it("⭐ toplar duruma göre katlanır, etiket Türkçe", () => {
    const f = foldRollsByStatus([
      { id: "1", title: "B1", detail: "WAREHOUSE · 50 m · Ana" },
      { id: "2", title: "B2", detail: "IN_PRODUCTION · 40 m" },
      { id: "3", title: "B3", detail: "WAREHOUSE · 30 m · Ana" },
    ]);
    expect(f.map((g) => [g.label, g.records.length])).toEqual([
      ["Depoda", 2],
      ["Üretimde", 1],
    ]);
  });
});
