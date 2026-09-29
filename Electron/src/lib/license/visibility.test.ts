import { describe, it, expect } from "vitest";
import { isLicenseScreenVisible, licenseLockKind } from "./visibility";
import { ceilingAllowsField } from "./ceiling";

/**
 * Gözlem = sıfır fark: lisans ekranı yalnız satıcı kapısı açık oturuma, kilit hiç.
 */
describe("isLicenseScreenVisible", () => {
  it("⭐ gözlemde (ya da kip bilinmiyorken) yalnız satıcı kapısı açıksa", () => {
    expect(isLicenseScreenVisible({ kip: "gozlem", superadminGateOpen: false })).toBe(false);
    expect(isLicenseScreenVisible({ kip: null, superadminGateOpen: false })).toBe(false);
    expect(isLicenseScreenVisible({ kip: "gozlem", superadminGateOpen: true })).toBe(true);
  });
  it("zorlamada izin yeter (kimlik kapısı yok)", () => {
    expect(isLicenseScreenVisible({ kip: "zorla", superadminGateOpen: false })).toBe(true);
  });
});

describe("licenseLockKind", () => {
  it("yalnız KISITLI ve DURDURULMUS kilit doğurur; belirsizlik (null) bugünkü davranış", () => {
    expect(licenseLockKind({ kademe: "DURDURULMUS" })).toBe("suspended");
    expect(licenseLockKind({ kademe: "KISITLI" })).toBe("restricted");
    for (const k of ["NORMAL", "UYARI", "EK_SURE"] as const) expect(licenseLockKind({ kademe: k })).toBeNull();
    expect(licenseLockKind(null)).toBeNull();
  });
});

describe("ceilingAllowsField (backend ceilingAllows aynası)", () => {
  it("tavan uygulanmıyorsa her modül serbest", () => {
    expect(ceilingAllowsField({ applies: false }, "financeEnabled")).toBe(true);
  });
  it("⭐ lisanstaki listede olmayan ya da dondurulan modül kapalı; anahtar DB biçiminden çevrilir", () => {
    const c = { applies: true as const, allowed: ["production.enabled", "depo.multiEnabled"], denied: ["production.enabled"] };
    expect(ceilingAllowsField(c, "depoMultiEnabled")).toBe(true);
    expect(ceilingAllowsField(c, "financeEnabled")).toBe(false);
    expect(ceilingAllowsField(c, "productionEnabled")).toBe(false);
  });
  it("liste yok (yalnız dondurma) → yalnız dondurulan kapalı", () => {
    const c = { applies: true as const, allowed: null, denied: ["finance.enabled"] };
    expect(ceilingAllowsField(c, "financeEnabled")).toBe(false);
    expect(ceilingAllowsField(c, "dokumaEnabled")).toBe(true);
  });
});
