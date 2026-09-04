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
    depoMultiEnabled: false,
    ticaretEnabled: false,
    iplikEnabled: false,
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
    regime = { productionEnabled: true, financeEnabled: false };
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
    // ⚠️ 2026-09-04: DAVRANIŞ bayrakları Genel Ayarlar'dan ayrıldı → adres artık
    // `/system/feature-flags`. Palet adresi ELLE YAZMAZ, `settingsCategoryPath`ten
    // alır; bu satır o köprünün ekrandaki kanıtıdır (elle yazım geri gelirse
    // kategorilerin yarısı olmayan bir sekmeye giderdi).
    expect(openTab).toHaveBeenCalledWith("/system/feature-flags?tab=production");
  });

  /**
   * SIRALAMA — tam ad eşleşmesi HER ZAMAN kazanır.
   *
   * Ölçülen arıza (2026-08-27): filtre 1/0 döndüğü için eşleşen her kayıt aynı
   * puanı alıyordu ve sırayı DOM belirliyordu. "Müşteri Karnesi" yazan kullanıcı
   * Enter'a basınca "Sipariş İptal Karnesi" açılıyordu — o kaydın AÇIKLAMASINDA
   * "Müşteriler…" geçiyor ve listede daha yukarıda duruyor. Bir palette, tam adı
   * yazılan sayfayı açmıyorsa palet değildir.
   */
  it("tam ad eşleşmesi ilk sırada — açıklamadan eşleşen kaydın ÖNÜNDE", async () => {
    permissions = ["report:sales", "report:customer"];
    open();
    type("müşteri karnesi");

    const items = await screen.findAllByRole("option");
    const labels = items.map((el) => el.textContent ?? "");
    // İkisi de eşleşmeli (küme değişmedi) ...
    expect(labels.some((l) => l.includes("Müşteri Karnesi"))).toBe(true);
    expect(labels.some((l) => l.includes("Sipariş İptal Karnesi"))).toBe(true);
    // ... ama SIRA: tam ad önce.
    const exact = labels.findIndex((l) => l.includes("Müşteri Karnesi"));
    const viaDescription = labels.findIndex((l) => l.includes("Sipariş İptal Karnesi"));
    expect(exact).toBeLessThan(viaDescription);
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

  it("seçim hedefi sekme olarak açar — varsa odaklar (yeni PENCERE açmaz)", () => {
    open();
    fireEvent.click(screen.getByText("Nerede Takıldı (WIP)"));
    expect(openTab).toHaveBeenCalledWith("/reports/production/wip");
  });
});
