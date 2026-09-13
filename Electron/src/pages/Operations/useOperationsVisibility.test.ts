import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { FeatureFlags } from "@/services/featureFlagService";
import { useOperationsVisibilityContext } from "./useOperationsVisibility";

// =============================================================================
// BAYRAK OKUNAMADIĞINDA YÖN — modül bağlamının tek çözüm noktası (1e ek şartı,
// 2026-09-14): karo · palet · route kapısı üçü de bu bağlamı okur; bayrak
// yüklenmemişken yön ALAN BAŞINA backend okuyucusunun satır-yok değeridir —
// `production` AÇIK (satır yoksa TRUE), diğer modüller KAPALI. Zincir (iplik =
// ticaret && iplik · devere · dokuma = production && dokuma) da burada çözülür.
// =============================================================================

let flagsData: Partial<FeatureFlags> | undefined;
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
  });

  it("⭐ zincir tek yerde: dokuma AÇIK ama üretim KAPALI → etkin dokuma KAPALI", () => {
    flagsData = { productionEnabled: false, dokumaEnabled: true };
    expect(ctx().dokumaEnabled).toBe(false);
    flagsData = { productionEnabled: true, dokumaEnabled: true };
    expect(ctx().dokumaEnabled).toBe(true);
  });

  it("zincir: iplik AÇIK ama ticaret KAPALI → etkin iplik KAPALI; devere ipliğe bağlı", () => {
    flagsData = { ticaretEnabled: false, iplikEnabled: true, devereEnabled: true };
    const c = ctx();
    expect(c.iplikEnabled).toBe(false);
    expect(c.devereEnabled).toBe(false);
  });
});
