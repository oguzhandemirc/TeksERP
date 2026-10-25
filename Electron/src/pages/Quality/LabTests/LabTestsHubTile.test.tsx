// Operasyon hub'ı › Kalite Güvence: bayrak kapalıyken karo soluk + mesaj (gezinme yok); izinsizde hiç yok.
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
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false, tezgahEnabled: false, kaliteGuvenceEnabled: flagOn,
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

import { OperationsHubPage } from "@/pages/Operations/OperationsHubPage";

const labCard = () => screen.queryByText("Lab Testleri")?.closest("button") ?? null;

describe("Kalite Güvence karosu", () => {
  beforeEach(() => { info.mockReset(); window.history.pushState({}, "", "/operations"); });
  it("bayrak kapalı + izinli → grup ve soluk karo; tık mesaj verir, gezinmez", () => {
    flagOn = false; perms = "all";
    renderWithProviders(<OperationsHubPage />);
    expect(screen.getByText("Kalite Güvence")).toBeTruthy();
    const card = labCard();
    expect(card?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(card!);
    expect(info).toHaveBeenCalledWith("Kalite Güvence kapalı — Genel Ayarlar'dan açılır");
    expect(window.location.pathname).toBe("/operations");
  });
  it("bayrak açık → karo etkin (kapalı işareti yok)", () => {
    flagOn = true; perms = "all";
    renderWithProviders(<OperationsHubPage />);
    expect(labCard()?.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByText("kapalı")).toBeNull();
  });
  it("labtest:read yoksa karo da grup da çizilmez (bayrak açık ya da kapalı)", () => {
    perms = ["order:read"];
    for (const f of [false, true]) {
      flagOn = f;
      const r = renderWithProviders(<OperationsHubPage />);
      expect(labCard()).toBeNull();
      expect(screen.queryByText("Kalite Güvence")).toBeNull();
      r.unmount();
    }
  });
});
