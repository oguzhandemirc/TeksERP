import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { EMPTY_MENU_LAYOUT } from "@/lib/menu-layout";
import { Sidebar } from "./Sidebar";
import { useMenuContextStore } from "./menu-context";

/**
 * T5 menü bölümleri: kök bölüm sayfasına gider, ok alt listeyi açar, alt liste bölüm sayfasıyla AYNI
 * süzgeçten gelir, görünür alt öğesi olmayan kök çizilmez; daraltılmış menüde alt liste yan panelde.
 */
let perms: string[] = [];
let activePath: string | null = null;
let devere = false;
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
    devereEnabled: devere, tezgahEnabled: false, kaliteGuvenceEnabled: true, maliyetEnabled: true,
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
  useTabsStore: (sel: (s: unknown) => unknown) => sel({ tabs: activePath ? [{ id: "t1", path: activePath }] : [], activeId: activePath ? "t1" : null, openTab }),
  selectActivePath: () => activePath,
}));
vi.mock("./tabs/use-tab-target", () => ({ useTabTarget: (to: string) => ({ onClick: () => openTab(to) }) }));
vi.mock("./sidebar-brand", () => ({ SidebarBrand: () => null, SidebarFooter: () => null }));

const nav = () => screen.getByRole("navigation");
// dnd-kit sürüklenebilir <li> da role="button" taşır (menü sıralama) — gerçek düğmeyi seç.
const rootBtn = (name: string) => within(nav()).queryAllByRole("button", { name }).find((b) => b.tagName === "BUTTON") ?? null;
const subHead = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("[data-nav-subgroup]")].find((b) => b.textContent?.includes(name))!;

describe("Sidebar — T5 bölüm kökleri", () => {
  beforeEach(() => {
    perms = ["order:read", "workorder:read", "roll:read", "shipping:read"];
    activePath = null;
    openTab.mockClear();
    localStorage.clear();
  });

  it("⭐ kökler sırayla çizilir; eski 'Operasyon' kökü yok", () => {
    render(<Sidebar collapsed={false} />);
    const labels = within(nav()).getAllByRole("button").filter((b) => b.tagName === "BUTTON").map((b) => b.textContent?.trim());
    const order = ["Satış", "Depo", "Üretim", "Sevkiyat"].map((l) => labels.indexOf(l));
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
});

describe("Sidebar — süreç alt grupları (2026-11-20)", () => {
  beforeEach(() => {
    activePath = null;
    openTab.mockClear();
    localStorage.clear();
  });

  it("⭐ süreç alt grubu: bölüm açılınca grup başlığı, başlık tıklanınca ekranlar (2026-11-20)", () => {
    perms = ["roll:read", "shipping:read"];
    render(<Sidebar collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Sevkiyat alt menüsü" }));
    const head = subHead("Sevk Çıkışı");
    expect(head).toHaveAttribute("data-nav-subgroup");
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Sevkiyatlar")).toBeNull();
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByText("Sevkiyatlar"));
    expect(openTab).toHaveBeenLastCalledWith("/operations/shipments");
  });

  it("süreç alt grubu: etkin ekranın grubu kendiliğinden açık; daraltılmış panelde başlık etiket", () => {
    perms = ["roll:read", "shipping:read"];
    activePath = "/operations/rolls";
    const { unmount } = render(<Sidebar collapsed={false} />);
    expect(subHead("Kumaş ve Paketleme")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Kumaş Stoğu").closest("button")).toHaveAttribute("aria-current", "page");
    unmount();
    activePath = null;
    render(<Sidebar collapsed />);
    fireEvent.click(rootBtn("Sevkiyat")!);
    expect(screen.getByText("Sevk Çıkışı").tagName).toBe("P");
    expect(screen.getByText("Sevkiyatlar")).toBeInTheDocument();
  });

  it("⭐ bölüm olmayan hub kökü (Maliyet) de açılır grup; alt öğeler palet filtresinden, alt gruplu", () => {
    perms = ["cost:read"];
    render(<Sidebar collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Maliyet alt menüsü" }));
    fireEvent.click(subHead("Girdi Fiyatları"));
    expect(screen.getByText("İplik Maliyet Fiyatları")).toBeInTheDocument();
    // Raporlar alt listesiz kalır (kendi gezinmesi var).
    expect(screen.queryByRole("button", { name: "Raporlar alt menüsü" })).toBeNull();
  });

});

describe("Sidebar — aynı ekran iki kökte (menü bağlamı, 2026-11-23)", () => {
  const FI = "/operations/fasondaki-iplik";
  // Bölüm kapsayıcısı: ok düğmesi → kök satırı → SectionNavItem sarmalı (alt liste burada).
  const fiIn = (root: string) => {
    const box = screen.getByRole("button", { name: `${root} alt menüsü` }).parentElement!.parentElement!;
    return [...box.querySelectorAll<HTMLButtonElement>("[data-nav-child]")].find((b) => b.textContent?.includes("Fasondaki İplik")) ?? null;
  };
  beforeEach(() => {
    perms = ["warping-order:read", "yarn:read"];
    devere = true;
    activePath = FI;
    openTab.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    useMenuContextStore.setState({ byTab: {}, pending: null });
  });

  it("⭐ bağlamsız açılış ekranın kendi kökünde (Üretim); Depo'dan tıklanınca Depo açık ve etkin kalır", () => {
    const { unmount } = render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("button", { name: "Üretim alt menüsü" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Depo alt menüsü" })).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll('[data-nav-child][aria-current="page"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Depo alt menüsü" }));
    fireEvent.click(subHead("İplik ve Sarf"));
    const depoFi = fiIn("Depo")!;
    fireEvent.click(depoFi);
    expect(openTab).toHaveBeenLastCalledWith(FI);
    expect(screen.getByRole("button", { name: "Depo alt menüsü" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Üretim alt menüsü" })).toHaveAttribute("aria-expanded", "false");
    expect(fiIn("Depo")).toHaveAttribute("aria-current", "page");
    expect(useMenuContextStore.getState().byTab.t1).toMatchObject({ owner: "/warehouse", to: FI, ownerLabel: "Depo" });

    // F5 / yeniden çizim: sekmenin bağlamı korunur.
    unmount();
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("button", { name: "Depo alt menüsü" })).toHaveAttribute("aria-expanded", "true");
    expect(fiIn("Depo")).toHaveAttribute("aria-current", "page");
  });
});
