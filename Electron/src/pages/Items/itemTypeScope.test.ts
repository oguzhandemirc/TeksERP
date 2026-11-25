// Seçiciden açılan Yeni/Örnek al ürün penceresinde Tip kapsamı (inceleme Not 10b, 2026-11-25).
import { describe, expect, it } from "vitest";
import type { ItemType } from "@/types/enums";
import { itemTypeScope, productScope, scopeItemType } from "./itemTypeScope";

const T = (...t: string[]) => t as ItemType[];

describe("itemTypeScope", () => {
  it("kapsam yok ya da bütün tipler → serbest (bugünkü davranış)", () => {
    expect(productScope(undefined)).toBeNull();
    expect(productScope(T("YARN", "FABRIC", "CONSUMABLE"))).toBeNull();
    const s = itemTypeScope(undefined);
    expect(s.locked).toBe(false);
    expect(Object.keys(s.labels).sort()).toEqual(["CONSUMABLE", "FABRIC", "YARN"]);
    expect(s.info).toBeUndefined();
  });

  it("⭐ tek tip (yalnız kumaş) → kilitli, yalnız Kumaş, ⓘ nedenini söyler", () => {
    const s = itemTypeScope(T("FABRIC"));
    expect(s.locked).toBe(true);
    expect(s.labels).toEqual({ FABRIC: "Kumaş" });
    expect(s.info).toMatch(/yalnız “Kumaş” tipi seçilebilen/);
  });

  it("çok tip → kilit yok, yalnız o tipler seçilebilir; hizmet gibi ürün dışı tip yok sayılır", () => {
    const s = itemTypeScope(T("FABRIC", "CONSUMABLE", "SERVICE"));
    expect(s.locked).toBe(false);
    expect(Object.keys(s.labels).sort()).toEqual(["CONSUMABLE", "FABRIC"]);
  });

  it("⭐ ön değer: kapsam dışındaki tip kapsamın ilk tipine çekilir; kapsamdaysa dokunulmaz", () => {
    expect(scopeItemType({ itemType: "YARN" as const, name: "x" }, T("FABRIC")).itemType).toBe("FABRIC");
    expect(scopeItemType({ itemType: "CONSUMABLE" as const }, T("FABRIC", "CONSUMABLE")).itemType).toBe("CONSUMABLE");
    const v = { itemType: "YARN" as const };
    expect(scopeItemType(v, undefined)).toBe(v);
  });
});
