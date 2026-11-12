import { describe, expect, it } from "vitest";
import type { AppPreferences } from "@/types/preferences";
import { layoutOf } from "../ReportBody";
import { patchViewPref, readViewPref } from "./view-pref";

describe("rapor görünüm tercihi — raporlar.charts[raporAnahtarı]", () => {
  it("⭐ yazım yalnız o raporu yamalar; favoriler ve öbür raporların tercihi korunur", () => {
    const prefs: AppPreferences = { raporlar: { favoriler: ["a"], charts: { "sales/sevkiyat": { kind: "bar" } } } };
    const out = patchViewPref(prefs, "sales/siparis-talep", { kind: "area", labels: true });
    expect(out.raporlar?.favoriler).toEqual(["a"]);
    expect(out.raporlar?.charts?.["sales/sevkiyat"]).toEqual({ kind: "bar" });
    expect(out.raporlar?.charts?.["sales/siparis-talep"]).toEqual({ kind: "area", labels: true });
  });

  it("ikinci yama birinciyi ezmez, birleşir", () => {
    const first = patchViewPref({}, "k", { kind: "donut" });
    const second = patchViewPref(first as AppPreferences, "k", { layout: "stacked" });
    expect(second.raporlar?.charts?.k).toEqual({ kind: "donut", layout: "stacked" });
  });

  it("okurken süzer: bilinmeyen tür/alan düşer, gizli kolonlar yalnız metin", () => {
    expect(readViewPref({ kind: "uydurma", labels: "evet", layout: "yan", hiddenColumns: ["a", 3, "b"], x: 1 })).toEqual({ hiddenColumns: ["a", "b"] });
    expect(readViewPref(null)).toEqual({});
    expect(readViewPref({ kind: "treemap", labels: false, layout: "side" })).toEqual({ kind: "treemap", labels: false, layout: "side" });
  });

  it("yerleşim varsayılanı: dar tablo yan yana, geniş tablo üst üste; seçim varsa o", () => {
    expect(layoutOf(undefined, 4)).toBe("side");
    expect(layoutOf(undefined, 10)).toBe("stacked");
    expect(layoutOf("side", 10)).toBe("side");
  });
});
