import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { EMPTY_MENU_LAYOUT } from "@/lib/menu-layout";
import { Sidebar } from "./Sidebar";
import { activeChildOf } from "./sidebar-section";

/**
 * T5 menü bölümleri: kök bölüm sayfasına gider, ok alt listeyi açar, alt liste bölüm sayfasıyla AYNI
 * süzgeçten gelir, görünür alt öğesi olmayan kök çizilmez; daraltılmış menüde alt liste yan panelde.
 */
let perms: string[] = [];
let activePath: string | null = null;
const openTab = vi.fn();
vi.mock("@/hooks/useMenuLayout", () => ({ useMenuLayout: () => EMPTY_MENU_LAYOUT }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    isAdmin: false,
    permissions: perms,
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (l: string[]) => l.some((p) => perms.includes(p)),
  }),
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
vi.mock("@/lib/off-module-visibility", () => ({
  useCanSeeOffModules: () => false,
  offEntryMode: (off: boolean) => (off ? "hide" : "show"),
}));
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
  useTabsStore: (sel: (s: unknown) => unknown) => sel({ tabs: [], activeId: null, openTab }),
  selectActivePath: () => activePath,
}));
vi.mock("./tabs/use-tab-target", () => ({ useTabTarget: (to: string) => ({ onClick: () => openTab(to) }) }));
vi.mock("./sidebar-brand", () => ({ SidebarBrand: () => null, SidebarFooter: () => null }));

const nav = () => screen.getByRole("navigation");
// dnd-kit sürüklenebilir <li> da role="button" taşır (menü sıralama) — gerçek düğmeyi seç.
const rootBtn = (name: string) => within(nav()).queryAllByRole("button", { name }).find((b) => b.tagName === "BUTTON") ?? null;

describe("Sidebar — T5 bölüm kökleri", () => {
  beforeEach(() => {
    perms = ["order:read", "workorder:read", "roll:read", "shipping:read"];
    activePath = null;
    openTab.mockClear();
  });

  it("⭐ kökler sırayla çizilir; eski 'Operasyon' kökü yok", () => {
    render(<Sidebar collapsed={false} />);
    const labels = within(nav()).getAllByRole("button").filter((b) => b.tagName === "BUTTON").map((b) => b.textContent?.trim());
    const order = ["Satış", "Üretim", "Depo", "Sevkiyat"].map((l) => labels.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(labels).not.toContain("Operasyon");
  });

  it("⭐ köke tıklamak bölüm sayfasını açar; ok alt listeyi açar ve kapatır (gezinmez)", () => {
    render(<Sidebar collapsed={false} />);
    fireEvent.click(rootBtn("Satış")!);
    expect(openTab).toHaveBeenLastCalledWith("/sales");
    openTab.mockClear();
    const toggle = screen.getByRole("button", { name: "Satış alt menüsü" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Siparişler")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(openTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Siparişler"));
    expect(openTab).toHaveBeenLastCalledWith("/operations/orders");
    fireEvent.click(toggle);
    expect(screen.queryByText("Siparişler")).toBeNull();
  });

  it("⭐ alt liste izinle süzülür: izinsiz karo listede yok", () => {
    render(<Sidebar collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Satış alt menüsü" }));
    expect(screen.getByText("Siparişler")).toBeInTheDocument();
    expect(screen.queryByText("Siparişe Yazılamayanlar")).toBeNull();
  });

  it("⭐ görünür alt öğesi olmayan kök çizilmez", () => {
    perms = ["roll:read"];
    render(<Sidebar collapsed={false} />);
    expect(rootBtn("Depo")).not.toBeNull();
    expect(rootBtn("Satış")).toBeNull();
    expect(rootBtn("Sevkiyat")).toBeNull();
  });

  it("alt sayfa açıkken bölüm kendiliğinden açık doğar ve alt öğe işaretlenir", () => {
    activePath = "/operations/orders/abc";
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("button", { name: "Satış alt menüsü" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Siparişler").closest("button")).toHaveAttribute("aria-current", "page");
  });

  it("daraltılmış menü: bölüm kökü yan paneli açar; panelde bölüm sayfası + alt öğeler", () => {
    render(<Sidebar collapsed />);
    fireEvent.click(rootBtn("Satış")!);
    expect(openTab).not.toHaveBeenCalled();
    expect(screen.getByText("tüm kartlar")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Siparişler"));
    expect(openTab).toHaveBeenLastCalledWith("/operations/orders");
  });

  it("activeChildOf: en uzun ön ek kazanır, ilgisiz yol null", () => {
    const kids = [
      { label: "A", to: "/operations/gelen-belgeler", icon: () => null },
      { label: "B", to: "/operations/gelen-belgeler/sablonlar", icon: () => null },
    ] as never;
    expect(activeChildOf(kids, "/operations/gelen-belgeler/sablonlar/1")).toBe("/operations/gelen-belgeler/sablonlar");
    expect(activeChildOf(kids, "/operations/gelen-belgeler/9")).toBe("/operations/gelen-belgeler");
    expect(activeChildOf(kids, "/operations/rolls")).toBeNull();
  });
});
