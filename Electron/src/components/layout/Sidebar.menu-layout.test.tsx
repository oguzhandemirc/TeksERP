import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { EMPTY_MENU_LAYOUT, toMenuLayoutState, type MenuLayoutState } from "@/lib/menu-layout";
import { Sidebar } from "./Sidebar";

/**
 * K19 MENÜ DÜZENİ — kenar menü yüzü. Varsayılan (ayar yok / sunucu varsayılanı) menü BAYT BAYT aynı; gizlenen kök
 * satır kalkar; Gelişmiş grubu yalnız ayar açıkken çizilir, KAPALI doğar, başlığa tıklayınca açılır.
 */
let menu: MenuLayoutState = EMPTY_MENU_LAYOUT;
vi.mock("@/hooks/useMenuLayout", () => ({ useMenuLayout: () => menu }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, ticaretEnabled: false, iplikEnabled: false,
    devereEnabled: false, tezgahEnabled: false, kaliteGuvenceEnabled: true, maliyetEnabled: true,
    gelenBelgeEnabled: false, emanetEnabled: false, productionEnabled: true, financeEnabled: true,
    dokumaEnabled: false, machineStopEnabled: false, reportsClosedKeys: [], isReportOpen: () => true,
    flagsReady: true, flagsFailed: false,
  }),
}));
vi.mock("@/lib/off-module-visibility", () => ({ useCanSeeOffModules: () => false, offEntryMode: () => "hide" }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], reorderFavorites: vi.fn() }) }));
vi.mock("@/hooks/useMenuOrder", () => ({
  useMenuOrder: () => ({ orderItems: (_g: string, items: unknown[]) => items, setGroupOrder: vi.fn() }),
}));
vi.mock("@/hooks/useLicenseStatus", () => ({ useLicenseScreenVisible: () => false }));
vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: { isSystemAccount: boolean; systemAccountExists: boolean }) => unknown) =>
    sel({ isSystemAccount: false, systemAccountExists: true }),
}));
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: unknown) => unknown) => sel({ tabs: [], activeId: null, openTab: vi.fn() }),
  selectActivePath: () => null,
}));
vi.mock("./tabs/use-tab-target", () => ({ useTabTarget: () => ({ onClick: vi.fn() }) }));
vi.mock("./sidebar-brand", () => ({ SidebarBrand: () => null, SidebarFooter: () => null }));

const ADVANCED = ["system/server-status", "system/perf", "system/clients", "access/permissions"];
const navHtml = (collapsed = false) => {
  const { container, unmount } = render(<Sidebar collapsed={collapsed} />);
  // dnd-kit her render'da artan erişilebilirlik kimliği üretir (DndDescribedBy-N, DndLiveRegion-N) — içerikten bağımsız, normalleşir.
  const html = (container.querySelector("nav")?.innerHTML ?? "").replace(/Dnd(DescribedBy|LiveRegion)-\d+/g, "Dnd$1-N");
  unmount();
  return html;
};

describe("Sidebar — K19 menü düzeni", () => {
  beforeEach(() => {
    menu = EMPTY_MENU_LAYOUT;
  });

  it("⭐ varsayılan: sunucu varsayılan görünümü (hiçbiri gizli, Gelişmiş kapalı) ↔ ayar yok → menü bayt bayt aynı", () => {
    const before = navHtml();
    menu = toMenuLayoutState({ hiddenScreens: [], advancedGroup: false, advancedScreens: ADVANCED });
    expect(navHtml()).toBe(before);
    expect(before).not.toContain("Gelişmiş");
    expect(before).toContain("Belgeler");
  });

  it("gizlenen kök satır kalkar, diğerleri durur", () => {
    menu = toMenuLayoutState({ hiddenScreens: ["documents"], advancedGroup: false, advancedScreens: [] });
    render(<Sidebar collapsed={false} />);
    expect(screen.queryByText("Belgeler")).not.toBeInTheDocument();
    expect(screen.getByText("Raporlar")).toBeInTheDocument();
  });

  it("⭐ Gelişmiş grubu açıkken çizilir, KAPALI doğar; başlığa tıklayınca teknik ekranlar görünür", () => {
    menu = toMenuLayoutState({ hiddenScreens: [], advancedGroup: true, advancedScreens: ADVANCED });
    render(<Sidebar collapsed={false} />);
    const head = screen.getByRole("button", { name: /Gelişmiş/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Sunucu Durumu")).not.toBeInTheDocument();
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Sunucu Durumu")).toBeInTheDocument();
    // superadminOnly (Endpoint Performansı) hub ile AYNI kapıdan geçer: fabrika yöneticisine çizilmez.
    expect(screen.queryByText("Endpoint Performansı")).not.toBeInTheDocument();
  });

  it("Gelişmiş grubundaki ekran gizlenmişse grupta da yok", () => {
    menu = toMenuLayoutState({ hiddenScreens: ["system/server-status"], advancedGroup: true, advancedScreens: ADVANCED });
    render(<Sidebar collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Gelişmiş/ }));
    expect(screen.queryByText("Sunucu Durumu")).not.toBeInTheDocument();
  });

  it("dar menü: Gelişmiş tek düğme, varsayılan kapalı", () => {
    menu = toMenuLayoutState({ hiddenScreens: [], advancedGroup: true, advancedScreens: ADVANCED });
    render(<Sidebar collapsed />);
    const btn = screen.getByRole("button", { name: "Gelişmiş" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
