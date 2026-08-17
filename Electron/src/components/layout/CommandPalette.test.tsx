import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { CommandPalette } from "./CommandPalette";

/**
 * Ctrl+K paleti — SAHA ŞİKÂYETİNİN davranış bekçisi (2026-08-06):
 * "arama modalı açılıyor ama bir çok menü çıkmıyor."
 *
 * Katalogun bütünlüğünü `command-entries.test.ts` kilitliyor; burada kilitlenen
 * şey EKRANDA ne olduğu: raporlar listede çıkıyor mu, alt başlıklar arama ile
 * geliyor mu, izinsiz kullanıcıya sızıyor mu.
 */

let permissions: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    user: null,
    permissions,
    isAdmin: permissions.includes("admin:users") || permissions.includes("admin:settings"),
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions.includes(p)),
  }),
}));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({
    shipmentConfirmationEnabled: false,
    pendingPlannedShipments: 0,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));

const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { openTab: unknown }) => unknown) => sel({ openTab }),
}));
vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: { logout: unknown }) => unknown) => sel({ logout: vi.fn() }),
}));

const open = () => renderWithProviders(<CommandPalette open onOpenChange={vi.fn()} />);

/**
 * Arama kutusuna yaz. `userEvent.type` yerine `fireEvent.change`: girdi bizim
 * kontrol ettiğimiz basit bir `<input>` (cmdk `value`/`onValueChange`), tuş tuş
 * yazmanın kazandırdığı bir şey yok — buna karşılık yüklü makinede varsayılan
 * 5 sn'lik test bütçesini aşıp bekçiyi FLAKY yapıyordu.
 */
const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText(/ara/i), { target: { value: text } });

describe("CommandPalette", () => {
  beforeEach(() => {
    permissions = ["report:production", "roll:read", "workorder:read", "admin:settings", "admin:users"];
    openTab.mockClear();
  });

  it("rapor sayfaları arama yapmadan da listede", () => {
    // Şikâyetin merkezi: Raporlar hiç eklenmemişti — hub da alt rapor da yoktu.
    open();
    expect(screen.getByText("Üretim")).toBeInTheDocument();
    expect(screen.getByText("Nerede Takıldı (WIP)")).toBeInTheDocument();
  });

  it("izin yoksa rapor girişi hiç çizilmez", () => {
    permissions = ["roll:read"];
    open();
    expect(screen.queryByText("Nerede Takıldı (WIP)")).not.toBeInTheDocument();
  });

  it("alt başlık (sekme) boş palette YOK, aranınca VAR", async () => {
    open();
    expect(screen.queryByText("Envanter · Ham Stok")).not.toBeInTheDocument();

    type("ham stok");
    expect(await screen.findByText("Envanter · Ham Stok")).toBeInTheDocument();
  });

  it("tek tek ayar satırı adıyla bulunur ve kendi sekmesini açar", async () => {
    open();
    type("mükerrer");

    fireEvent.click(await screen.findByText(/mükerrer top uyarısı/i));
    expect(openTab).toHaveBeenCalledWith("/system/settings?tab=production");
  });

  it("seçim hedefi sekme olarak açar — varsa odaklar (yeni PENCERE açmaz)", () => {
    open();
    fireEvent.click(screen.getByText("Nerede Takıldı (WIP)"));
    expect(openTab).toHaveBeenCalledWith("/reports/production/wip");
  });
});
