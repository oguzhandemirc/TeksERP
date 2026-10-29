// Kalite Güvence kökü (UX-2 K1): bayrak kapalıyken karo soluk + mesaj (gezinme yok); izinsizde hiç yok.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

let flagOn = false;
let perms: string[] | "all" = "all";
const info = vi.fn();
vi.mock("sonner", () => ({ toast: { info: (...a: unknown[]) => info(...a), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false, tezgahEnabled: false, kaliteGuvenceEnabled: flagOn, maliyetEnabled: false, gelenBelgeEnabled: false, emanetEnabled: false,
    financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: false, reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false,
  }),
}));
const has = (p: string) => perms === "all" || perms.includes(p);
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: false, hasPermission: has, hasAnyPermission: (ps: string[]) => ps.some(has) }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));

import { QualityHubPage } from "@/pages/Quality/QualityHubPage";
import { KALITE_GUVENCE_OFF_HINT } from "@/pages/Quality/tile-config";

const certCard = () => screen.queryByText("Sertifikalar")?.closest("button") ?? null;

describe("Kalite Güvence › Sertifikalar karosu", () => {
  beforeEach(() => { info.mockReset(); window.history.pushState({}, "", "/quality"); });
  it("bayrak kapalı + izinli → soluk karo + ayar yolu; tık mesaj verir, gezinmez", () => {
    flagOn = false; perms = "all";
    renderWithProviders(<QualityHubPage />);
    const card = certCard();
    expect(card?.getAttribute("aria-disabled")).toBe("true");
    expect(card?.querySelector('[data-testid="hub-off-hint"]')?.textContent).toBe(KALITE_GUVENCE_OFF_HINT);
    fireEvent.click(card!);
    expect(info).toHaveBeenCalledWith(KALITE_GUVENCE_OFF_HINT);
    expect(window.location.pathname).toBe("/quality");
  });
  it("bayrak açık → karo etkin (kapalı işareti yok)", () => {
    flagOn = true; perms = "all";
    renderWithProviders(<QualityHubPage />);
    expect(certCard()?.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByText("kapalı")).toBeNull();
  });
  it("certificate:read yoksa karo çizilmez (bayrak açık ya da kapalı)", () => {
    perms = ["order:read", "labtest:read"];
    for (const f of [false, true]) {
      flagOn = f;
      const r = renderWithProviders(<QualityHubPage />);
      expect(certCard()).toBeNull();
      r.unmount();
    }
  });
});
