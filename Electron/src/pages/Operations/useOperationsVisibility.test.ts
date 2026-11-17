import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { FeatureFlagsView } from "@/services/featureFlagService";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { useOperationsVisibilityContext } from "./useOperationsVisibility";

// =============================================================================
// BAYRAK OKUNAMADIĞINDA YÖN — modül bağlamının tek çözüm noktası (1e ek şartı,
// 2026-09-14): karo · palet · route kapısı üçü de bu bağlamı okur; bayrak
// yüklenmemişken yön ALAN BAŞINA backend okuyucusunun satır-yok değeridir —
// `production` AÇIK (satır yoksa TRUE), diğer modüller KAPALI. Zincir (iplik =
// ticaret && iplik · devere · dokuma = production && dokuma) da burada çözülür.
// =============================================================================

let flagsData: Partial<FeatureFlagsView> | undefined;
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: flagsData === undefined ? undefined : { data: flagsData } }),
  useShipmentConfirmationEnabled: () => false,
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true }),
}));

const ctx = () => renderHook(() => useOperationsVisibilityContext()).result.current;

describe("useOperationsVisibilityContext — bayrak okunamadığında yön", () => {
  beforeEach(() => {
    flagsData = undefined;
  });

  it("⭐ data YOK → production AÇIK, diğer modüller KAPALI (satır-yok yönü, alan başına)", () => {
    const c = ctx();
    expect(c.productionEnabled).toBe(true);
    expect(c.financeEnabled).toBe(false);
    expect(c.ticaretEnabled).toBe(false);
    expect(c.iplikEnabled).toBe(false);
    expect(c.depoMultiEnabled).toBe(false);
    expect(c.devereEnabled).toBe(false);
    expect(c.dokumaEnabled).toBe(false);
    expect(c.kaliteGuvenceEnabled).toBe(false);
  });

  it("Kalite Güvence zincirsiz: üretim KAPALIYKEN de açık okunur (KK1 muayenesi üretimden bağımsız)", () => {
    flagsData = { productionEnabled: false, kaliteGuvenceEnabled: true };
    expect(ctx().kaliteGuvenceEnabled).toBe(true);
  });

  it("⭐ zincir tek yerde: dokuma AÇIK ama üretim KAPALI → etkin dokuma KAPALI", () => {
    flagsData = { productionEnabled: false, dokumaEnabled: true };
    expect(ctx().dokumaEnabled).toBe(false);
    flagsData = { productionEnabled: true, dokumaEnabled: true };
    expect(ctx().dokumaEnabled).toBe(true);
  });

  it("⭐ zincir: gelen belge AÇIK ama emanet KAPALI → etkin gelen belge KAPALI (karo + palet + route gizli)", () => {
    flagsData = { emanetEnabled: false, gelenBelgeEnabled: true };
    expect(ctx().gelenBelgeEnabled).toBe(false);
    flagsData = { emanetEnabled: true, gelenBelgeEnabled: true };
    expect(ctx().gelenBelgeEnabled).toBe(true);
  });

  it("⭐ lisans tavanı: şalter AÇIK ama `kapaliModuller`de → bağlamda kapalı, rota kapısı /cost/quotes'u kapatır", () => {
    flagsData = {
      productionEnabled: true,
      maliyetEnabled: true,
      kaliteGuvenceEnabled: true,
      financeEnabled: true,
      license: { kip: "zorla", kapaliModuller: [{ anahtar: "maliyet.enabled", neden: "LISANSTA_YOK" }, { anahtar: "kaliteGuvence.enabled", neden: "LISANSTA_YOK" }] },
    };
    const c = { ...ctx(), flagsReady: true };
    expect(c.maliyetEnabled).toBe(false);
    expect(c.kaliteGuvenceEnabled).toBe(false);
    expect(c.financeEnabled).toBe(true);
    expect(isRouteModuleOpen("/cost/quotes/new", c)).toBe(false);
    expect(isRouteModuleOpen("/quality/inspections", c)).toBe(false);
    expect(isRouteModuleOpen("/finance/cari", c)).toBe(true);
    flagsData = { ...flagsData, license: { kip: "gozlem", kapaliModuller: [] } };
    expect(isRouteModuleOpen("/cost/quotes/new", ctx())).toBe(true);
  });

  it("zincir: iplik AÇIK ama ticaret KAPALI → etkin iplik KAPALI; devere BAĞIMSIZ kalır (K3 2026-09-14)", () => {
    flagsData = { ticaretEnabled: false, iplikEnabled: true, devereEnabled: true };
    const c = ctx();
    expect(c.iplikEnabled).toBe(false);
    // Hazır/fason levent iplik tüketmez: devere karosu iplik/ticaret kapalıyken de çizilir.
    expect(c.devereEnabled).toBe(true);
  });
});
