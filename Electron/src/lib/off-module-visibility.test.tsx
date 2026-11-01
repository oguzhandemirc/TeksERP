// Kapalı modül girişi yalnız modülü açabilene (süperadmin) soluk çizilir; fabrika yöneticisi ve operatör
// hiç görmez (kullanıcı kararı 2026-11-01). Menü satırı + hub karoları iki rolde ölçülür; yüklem
// `off-module-visibility.ts`ten gelir, auth store'u gerçek (rol yalnız `useRoleAccess` sahtesiyle).
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { TERIM_AD, TERIM } from "@/lib/terim";
import { canSeeOffModules, offEntryMode } from "./off-module-visibility";

let ready = true;
const ctx = (): OperationsVisibilityContext =>
  ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false,
    dokumaEnabled: false, machineStopEnabled: false, tezgahEnabled: false, kaliteGuvenceEnabled: false,
    maliyetEnabled: false, gelenBelgeEnabled: false, emanetEnabled: false,
    financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: true,
    reportsClosedKeys: [], isReportOpen: () => true, reportsV2Enabled: false,
    flagsReady: ready, flagsFailed: false,
  }) as OperationsVisibilityContext;
let isAdmin = true;
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx() }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin, permissions: [], hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], reorderFavorites: vi.fn(), isFavorite: () => false, toggleFavorite: vi.fn() }) }));
vi.mock("@/hooks/useMenuOrder", () => ({ useMenuOrder: () => ({ orderItems: <T,>(_g: string, i: T[]) => i, setGroupOrder: vi.fn() }) }));
vi.mock("@/components/layout/sidebar-brand", () => ({ SidebarBrand: () => null, SidebarFooter: () => null }));

import { Sidebar } from "@/components/layout/Sidebar";
import { QualityHubPage } from "@/pages/Quality/QualityHubPage";
import { OperationsHubPage } from "@/pages/Operations/OperationsHubPage";

type Role = "superadmin" | "factoryAdmin" | "operator";
function asRole(role: Role) {
  isAdmin = role !== "operator";
  useAuthStore.setState({ isSystemAccount: role === "superadmin", systemAccountExists: true });
}

afterEach(() => {
  ready = true;
  asRole("factoryAdmin");
});

describe("canSeeOffModules / offEntryMode — saf yüklem", () => {
  it("yalnız süperadmin; supap açıkken (sistem hesabı yok) fabrika yöneticisi; operatör hiç", () => {
    expect(canSeeOffModules({ isSystemAccount: true, systemAccountExists: true, isAdmin: false })).toBe(true);
    expect(canSeeOffModules({ isSystemAccount: false, systemAccountExists: true, isAdmin: true })).toBe(false);
    expect(canSeeOffModules({ isSystemAccount: false, systemAccountExists: false, isAdmin: true })).toBe(true);
    expect(canSeeOffModules({ isSystemAccount: false, systemAccountExists: false, isAdmin: false })).toBe(false);
  });
  it("açık giriş herkese; ipucusuz (rejim istisnası) kapalı giriş süperadmine de gizli", () => {
    expect(offEntryMode(false, false, false)).toBe("show");
    expect(offEntryMode(true, true, true)).toBe("dim");
    expect(offEntryMode(true, true, false)).toBe("hide");
    expect(offEntryMode(true, false, true)).toBe("hide");
  });
});

describe("Yan menü — kapalı Kalite Güvence satırı", () => {
  it("süperadmin: satır var, soluk ve 'kapalı' notlu", () => {
    asRole("superadmin");
    renderWithProviders(<Sidebar collapsed={false} />);
    const link = screen.getByText(TERIM_AD.kaliteGuvence).closest("button")!;
    expect(link).not.toBeNull();
    expect(link.className).toContain("opacity-50");
  });
  it.each(["factoryAdmin", "operator"] as const)("%s: satır hiç çizilmez", (role) => {
    asRole(role);
    renderWithProviders(<Sidebar collapsed={false} />);
    expect(screen.queryByText(TERIM_AD.kaliteGuvence)).toBeNull();
    expect(screen.getByText("Operasyon")).toBeInTheDocument();
  });
  it("bayrak yüklenmemişken süperadmine de çizilmez (titreme önleme korunur)", () => {
    ready = false;
    asRole("superadmin");
    renderWithProviders(<Sidebar collapsed={false} />);
    expect(screen.queryByText(TERIM_AD.kaliteGuvence)).toBeNull();
  });
});

describe("Hub karoları — kapalı modül karosu", () => {
  it("süperadmin: Kalite + Operasyon'da kapalı karo soluk ipucuyla çizilir", () => {
    asRole("superadmin");
    const q = renderWithProviders(<QualityHubPage />);
    expect(screen.getByText("Lab Testleri")).toBeInTheDocument();
    expect(screen.getAllByTestId("hub-off-hint").length).toBeGreaterThan(0);
    q.unmount();
    renderWithProviders(<OperationsHubPage />);
    expect(screen.getByText(TERIM.dokumaIsEmri.cogul)).toBeInTheDocument();
  });
  it.each(["factoryAdmin", "operator"] as const)("%s: kapalı karo hiç çizilmez, açık karo kalır", (role) => {
    asRole(role);
    const q = renderWithProviders(<QualityHubPage />);
    expect(screen.queryByText("Lab Testleri")).toBeNull();
    expect(screen.queryByTestId("hub-off-hint")).toBeNull();
    q.unmount();
    renderWithProviders(<OperationsHubPage />);
    expect(screen.queryByText(TERIM.dokumaIsEmri.cogul)).toBeNull();
    expect(screen.queryByTestId("hub-off-hint")).toBeNull();
  });
});
