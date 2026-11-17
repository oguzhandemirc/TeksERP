import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FeatureFlagsView } from "@/services/featureFlagService";
import { EMPTY_MENU_LAYOUT } from "@/lib/menu-layout";
import { Sidebar } from "./Sidebar";

/**
 * Lisans tavanı menüde (kullanıcı kararı 2026-11-17): `license.kapaliModuller`deki modül menüden TAMAMEN
 * gizlenir — süperadmine de soluk çizilmez. Bağlam GERÇEK (`useOperationsVisibilityContext`); yalnız
 * bayrak sorgusu taklit. Gözlem kipinde / blok yokken ham şalter geçerlidir (sıfır fark).
 */
let flags: Partial<FeatureFlagsView> = {};
let superadmin = false;
const perms = ["order:read", "quote:read", "cost:read", "finance:read"];
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { success: true, data: flags }, isSuccess: true, isError: false }),
  useShipmentConfirmationEnabled: () => false,
}));
vi.mock("@/hooks/useMenuLayout", () => ({ useMenuLayout: () => EMPTY_MENU_LAYOUT }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    isAdmin: superadmin,
    permissions: perms,
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (l: string[]) => l.some((p) => perms.includes(p)),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], reorderFavorites: vi.fn() }) }));
vi.mock("@/hooks/useMenuOrder", () => ({
  useMenuOrder: () => ({ orderItems: (_g: string, items: unknown[]) => items, setGroupOrder: vi.fn() }),
}));
vi.mock("@/hooks/useLicenseStatus", () => ({ useLicenseScreenVisible: () => false }));
vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: { isSystemAccount: boolean; systemAccountExists: boolean }) => unknown) =>
    sel({ isSystemAccount: superadmin, systemAccountExists: true }),
}));
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: unknown) => unknown) => sel({ tabs: [], activeId: null, openTab: vi.fn() }),
  selectActivePath: () => null,
}));
vi.mock("./tabs/use-tab-target", () => ({ useTabTarget: () => ({ onClick: vi.fn() }) }));
vi.mock("./sidebar-brand", () => ({ SidebarBrand: () => null, SidebarFooter: () => null }));

const nav = () => screen.getByRole("navigation");
const rootBtn = (name: string) => within(nav()).queryAllByRole("button", { name: new RegExp(`^${name}`) }).find((b) => b.tagName === "BUTTON") ?? null;
const salesChildren = () => {
  fireEvent.click(screen.getByRole("button", { name: "Satış alt menüsü" }));
  return within(nav());
};

const ON = { productionEnabled: true, maliyetEnabled: true, financeEnabled: true } as const;
const ZORLA_MALIYET_YOK: FeatureFlagsView["license"] = {
  kip: "zorla",
  kapaliModuller: [
    { anahtar: "maliyet.enabled", neden: "LISANSTA_YOK" },
    { anahtar: "kaliteGuvence.enabled", neden: "LISANSTA_YOK" },
    { anahtar: "gelenBelge.enabled", neden: "LISANSTA_YOK" },
  ],
};

describe("Sidebar — lisans tavanının kapattığı modül", () => {
  beforeEach(() => {
    superadmin = false;
    flags = { ...ON };
  });

  it("⭐ şalter AÇIK + lisansta YOK → Maliyet kökü ve Satış › Teklifler menüde yok", () => {
    flags = { ...ON, license: ZORLA_MALIYET_YOK };
    render(<Sidebar collapsed={false} />);
    expect(rootBtn("Maliyet")).toBeNull();
    expect(salesChildren().queryByText("Teklifler")).toBeNull();
    // Lisansın kapatmadığı modül etkilenmez.
    expect(rootBtn("Ön Muhasebe") ?? rootBtn("Ön muhasebe")).not.toBeNull();
  });

  it("⭐ süperadmin de görmez: lisans kapatması SOLUK değil, TAMAMEN gizli", () => {
    superadmin = true;
    flags = { ...ON, license: ZORLA_MALIYET_YOK };
    render(<Sidebar collapsed={false} />);
    expect(rootBtn("Maliyet")).toBeNull();
  });

  it("karşılaştırma: şalter KAPALI (lisans değil) → süperadmine soluk satır kalır", () => {
    superadmin = true;
    flags = { ...ON, maliyetEnabled: false, license: { kip: "zorla", kapaliModuller: [] } };
    render(<Sidebar collapsed={false} />);
    expect(rootBtn("Maliyet")).not.toBeNull();
  });

  it("⭐ gözlem kipi (boş liste) → Maliyet ve Teklifler görünür (sıfır fark)", () => {
    flags = { ...ON, license: { kip: "gozlem", kapaliModuller: [] } };
    render(<Sidebar collapsed={false} />);
    expect(rootBtn("Maliyet")).not.toBeNull();
    expect(salesChildren().getByText("Teklifler")).toBeInTheDocument();
  });

  it("eski sunucu (license bloğu yok) → ham şalter geçerli", () => {
    render(<Sidebar collapsed={false} />);
    expect(rootBtn("Maliyet")).not.toBeNull();
    expect(salesChildren().getByText("Teklifler")).toBeInTheDocument();
  });
});
