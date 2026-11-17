import { describe, expect, it } from "vitest";
import type { FeatureFlagsView } from "@/services/featureFlagService";
import { applyLicenseCeiling, isModuleEnabled, isPathLicenseClosed, licenseClosedModules } from "./module-enabled";

/** "Modül etkin mi" TEK yardımcı: ham şalter ∧ lisans tavanı ∧ ön koşul zinciri (kullanıcı kararı 2026-11-17). */
type L = FeatureFlagsView["license"];
const zorla = (...keys: string[]): L => ({ kip: "zorla", kapaliModuller: keys.map((anahtar) => ({ anahtar, neden: "LISANSTA_YOK" as const })) });

describe("isModuleEnabled", () => {
  it("⭐ şalter AÇIK + lisansta YOK → kapalı; lisans açık bırakılan modül etkilenmez", () => {
    const f = { productionEnabled: true, maliyetEnabled: true, financeEnabled: true, license: zorla("maliyet.enabled") };
    expect(isModuleEnabled(f, "maliyetEnabled")).toBe(false);
    expect(isModuleEnabled(f, "financeEnabled")).toBe(true);
  });

  it("⭐ gözlem kipi / blok yok → ham şalter (sıfır fark)", () => {
    expect(isModuleEnabled({ productionEnabled: true, maliyetEnabled: true, license: { kip: "gozlem", kapaliModuller: [] } }, "maliyetEnabled")).toBe(true);
    expect(isModuleEnabled({ productionEnabled: true, maliyetEnabled: true }, "maliyetEnabled")).toBe(true);
  });

  it("zincir korunur: maliyet = production ∧ maliyet; gelen belge = emanet ∧ gelenBelge (lisansta da)", () => {
    expect(isModuleEnabled({ productionEnabled: false, maliyetEnabled: true }, "maliyetEnabled")).toBe(false);
    const f = { emanetEnabled: true, gelenBelgeEnabled: true, license: zorla("emanet.enabled") };
    expect(isModuleEnabled(f, "gelenBelgeEnabled")).toBe(false);
    expect([...licenseClosedModules(f)].sort()).toEqual(["emanetEnabled", "gelenBelgeEnabled"]);
  });

  it("yüklenmemiş bayrak: production AÇIK, diğerleri KAPALI; production lisans listesinde olsa da açık", () => {
    expect(isModuleEnabled(undefined, "productionEnabled")).toBe(true);
    expect(isModuleEnabled(undefined, "maliyetEnabled")).toBe(false);
    expect(isModuleEnabled({ license: zorla("production.enabled") }, "productionEnabled")).toBe(true);
  });
});

describe("applyLicenseCeiling (useFeatureFlags görünümü)", () => {
  it("lisans bir şey kapatmıyorsa AYNI nesne (select kimliği kararlı)", () => {
    const f = { maliyetEnabled: true, license: { kip: "gozlem" as const, kapaliModuller: [] } };
    expect(applyLicenseCeiling(f)).toBe(f);
  });
  it("kapatılan alan false olur, ham nesne değişmez", () => {
    const f = { maliyetEnabled: true, financeEnabled: true, license: zorla("maliyet.enabled") };
    const out = applyLicenseCeiling(f);
    expect(out.maliyetEnabled).toBe(false);
    expect(out.financeEnabled).toBe(true);
    expect(f.maliyetEnabled).toBe(true);
  });
});

describe("isPathLicenseClosed", () => {
  it("ekran modülü ve ROUTE_ALSO_REQUIRES ek modülü", () => {
    const closed = licenseClosedModules({ license: zorla("maliyet.enabled", "finance.enabled") });
    expect(isPathLicenseClosed("/cost/quotes", closed)).toBe(true);
    expect(isPathLicenseClosed("/cost", closed)).toBe(true);
    expect(isPathLicenseClosed("/reports/maliyet/karlilik", licenseClosedModules({ license: zorla("finance.enabled") }))).toBe(true);
    expect(isPathLicenseClosed("/operations/orders", closed)).toBe(false);
    expect(isPathLicenseClosed("/cost/quotes", undefined)).toBe(false);
  });
});
