import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
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
// ⚠️ BAĞLAM TAM ve TİPLİ verilir. Eksik alan `undefined` gelir ve o alana bakan
// her `visibleWhen` yüklemi SESSİZCE false döner — yani palet girişi kaybolur
// ama test "izin/katalog hatası" diye okunur. Dönüş tipini yazmak, bağlama yeni
// bir alan eklendiği gün bu mock'u DERLEME zamanında düşürür.
let regime = { productionEnabled: true, financeEnabled: false };
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false,
    pendingPlannedShipments: 0,
    multiWarehouse: false,
    ...regime,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { navigateActive: unknown }) => unknown) => sel({ navigateActive }),
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
    regime = { productionEnabled: true, financeEnabled: false };
    navigateActive.mockClear();
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
    expect(navigateActive).toHaveBeenCalledWith("/system/settings?tab=production");
  });

  /**
   * REJİM PARİTESİ — palet, ayarlar ekranında GİZLİ olan bir sekmeye derin
   * bağlantı vermemeli. Fabrikada (finance kapalı) "Depo & Muhasebe" bölümü
   * çizilmiyor; paletten seçilseydi kullanıcı `?tab=finance` ile gider ve sayfa
   * sessizce başka bir sekmeye düşerdi ("Kurşun Sırası" dersi).
   */
  it("fabrikada (muhasebe kapalı) muhasebe ayar girişi paletten düşer", () => {
    open();
    type("risk limiti");
    expect(screen.queryByText(/risk limiti aşımında/i)).not.toBeInTheDocument();
  });

  it("ticarette (muhasebe açık) aynı ayar girişi paletten bulunur", async () => {
    regime = { productionEnabled: true, financeEnabled: true };
    open();
    type("risk limiti");
    expect(await screen.findByText(/risk limiti aşımında/i)).toBeInTheDocument();
  });

  it("seçim aktif sekmede gezinir (yeni pencere açmaz)", () => {
    open();
    fireEvent.click(screen.getByText("Nerede Takıldı (WIP)"));
    expect(navigateActive).toHaveBeenCalledWith("/reports/production/wip");
  });
});
