// =============================================================================
// BİLDİRİM PROFİLLERİ EKRANI (N4-PROFIL) — karo/rota kapısı · matris kaydı yalnız seçili profil ·
// kilit önizlemesi per-kişi seçimi · POST yeniden deneme aynı `clientToken` · arşivli profil salt okunur ·
// üyeli profil arşivlenemez.
// NEGATİF SONDA (2026-10-26, md5 geri): karoya `public: true` → "izinsiz kullanıcı karoyu görmez" ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { NOTIFICATION_PROFILES_ACCESS, SYSTEM_HUB_ACCESS } from "@/lib/permissions";
import type { FactoryDefaultKind, NotificationProfile } from "@/services/bildirimProfilService";
import { systemTiles } from "../tile-config";

const svc = vi.hoisted(() => ({
  liste: vi.fn(),
  olustur: vi.fn(),
  yenidenAdlandir: vi.fn(),
  arsivle: vi.fn(),
  hucreleriYaz: vi.fn(),
  kilitOnizleme: vi.fn(),
  uyeleriYaz: vi.fn(),
  adaylar: vi.fn(),
  fabrikaVarsayilani: vi.fn(),
  fabrikaVarsayilaniYaz: vi.fn(),
}));
vi.mock("@/services/bildirimProfilService", () => ({ bildirimProfilService: svc }));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }),
}));
const perms = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    isAdmin: false,
    hasPermission: (p: string) => perms.list.includes(p),
    hasAnyPermission: (ps: readonly string[]) => ps.some((p) => perms.list.includes(p)),
  }),
}));

const { NotificationProfilesPage } = await import("./NotificationProfilesPage");
const { ProfileFormDialog } = await import("./ProfileFormDialog");
const { SystemHubPage } = await import("../SystemHubPage");

const KINDS: FactoryDefaultKind[] = [
  { tur: "fason.donus-gecikti", ad: "Fason dönüşü gecikti", grup: "Fason", kilit: "YOK", durum: "MIRAS", esikler: { gun: 3 }, esikVar: true, ekAlicilar: [] },
  { tur: "sistem.yedek-basarisiz", ad: "Yedek başarısız", grup: "Sistem", kilit: "HER_ZAMAN", durum: "MIRAS", esikler: {}, esikVar: false, ekAlicilar: [] },
];
const prof = (id: string, ad: string, extra: Partial<NotificationProfile> = {}): NotificationProfile => ({
  id, kod: ad.slice(0, 3).toUpperCase(), ad, arsivlendi: null, hucreler: [], uyeler: [], izinsizUyeler: {}, ...extra,
});
const A = prof("p-a", "Amirler", { uyeler: [{ userId: "u1", ad: "Ali" }, { userId: "u2", ad: "Ayşe" }, { userId: "u3", ad: "Can" }] });
const B = prof("p-b", "Boyahane");

beforeEach(() => {
  for (const f of Object.values(svc)) f.mockReset();
  svc.liste.mockResolvedValue({ items: [A, B] });
  svc.fabrikaVarsayilani.mockResolvedValue({ turler: KINDS });
  svc.adaylar.mockResolvedValue({ items: [] });
  svc.hucreleriYaz.mockImplementation(async (id: string) => ({ ...A, id }));
  svc.uyeleriYaz.mockImplementation(async (id: string) => ({ ...A, id }));
});

describe("karo + rota kapısı", () => {
  it("karo ve rota AYNI erişim listesi; hub kapısı izni içerir", () => {
    const tile = systemTiles.find((t) => t.key === "notification-profiles");
    expect(tile?.permissionAny).toBe(NOTIFICATION_PROFILES_ACCESS);
    expect(tile?.to).toBe("/system/notification-profiles");
    const src = readFileSync(resolve(__dirname, "../../../routes/content-routes.tsx"), "utf8");
    const i = src.indexOf('path: "system/notification-profiles"');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 300)).toContain("requireAnyPermission={NOTIFICATION_PROFILES_ACCESS}");
    expect(SYSTEM_HUB_ACCESS).toContain("settings:notifications");
  });

  it("⭐ izinsiz kullanıcı karoyu görmez; settings:notifications ile görür", async () => {
    perms.list = ["system:activity"];
    const { unmount } = renderWithProviders(<SystemHubPage />);
    expect(await screen.findByText("Sistem Kayıtları")).toBeInTheDocument();
    expect(screen.queryByText("Bildirim profilleri")).toBeNull();
    unmount();
    perms.list = ["settings:notifications"];
    renderWithProviders(<SystemHubPage />);
    expect(await screen.findByText("Bildirim profilleri")).toBeInTheDocument();
  });
});

describe("matris", () => {
  it("⭐ kayıt yalnız seçili (değişen) profilin hücrelerini gönderir", async () => {
    renderWithProviders(<NotificationProfilesPage />);
    const radio = await screen.findByLabelText("Fason dönüşü gecikti: Açık");
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(svc.hucreleriYaz).toHaveBeenCalledTimes(1));
    expect(svc.hucreleriYaz).toHaveBeenCalledWith("p-a", [{ tur: "fason.donus-gecikti", durum: "ACIK" }]);
    expect(svc.kilitOnizleme).not.toHaveBeenCalled();
    expect(svc.uyeleriYaz).not.toHaveBeenCalled();
  });

  it("⭐ Fabrika varsayılanı Kaydet çubuğu PageBody dolgusu kadar aşağı yapışır, içeriğin üstüne binmez", async () => {
    renderWithProviders(<NotificationProfilesPage />);
    const tab = await screen.findByRole("tab", { name: "Fabrika varsayılanı" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    const bar = await screen.findByRole("toolbar", { name: "Fabrika varsayılanı kaydet" });
    expect(within(bar).getByRole("button", { name: "Kaydet" })).toBeInTheDocument();
    // PageBody `p-4 md:p-6` ↔ çubuk `-bottom-4 md:-bottom-6` + eş alt dolgu; opak zemin + üst katman.
    const cls = bar.className.split(/\s+/);
    for (const c of ["sticky", "-bottom-4", "md:-bottom-6", "pb-4", "md:pb-6", "bg-background", "z-10"]) expect(cls).toContain(c);
    expect(cls).not.toContain("bottom-0");
    const page = readFileSync(resolve(__dirname, "NotificationProfilesPage.tsx"), "utf8");
    expect(page).toContain('<PageBody className="p-4 md:p-6">');
  });

  it("her zaman kilitli türde Kapalı seçilemez", async () => {
    renderWithProviders(<NotificationProfilesPage />);
    expect(await screen.findByLabelText("Yedek başarısız: Kapalı")).toBeDisabled();
  });

  it("⭐ kilit önizlemesi: kişiler listelenir, seçimi kaldırılan profilden çıkar, sonra hücreler yazılır", async () => {
    svc.kilitOnizleme.mockResolvedValue({
      etkilenen: [
        { userId: "u1", ad: "Ali", turler: [{ tur: "fason.donus-gecikti", ad: "Fason dönüşü gecikti" }] },
        { userId: "u2", ad: "Ayşe", turler: [{ tur: "fason.donus-gecikti", ad: "Fason dönüşü gecikti" }] },
      ],
    });
    renderWithProviders(<NotificationProfilesPage />);
    fireEvent.click(await screen.findByLabelText("Fason dönüşü gecikti: Kilitli"));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    const list = await screen.findByRole("list", { name: "Tercihi ezilecek kişiler" });
    expect(within(list).getByText("Ali")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("checkbox", { name: "Ali" }));
    fireEvent.click(screen.getByRole("button", { name: /1 kişi profilden çıkar/ }));
    await waitFor(() => expect(svc.hucreleriYaz).toHaveBeenCalledTimes(1));
    expect(svc.uyeleriYaz).toHaveBeenCalledWith("p-a", ["u2", "u3"]);
    expect(svc.uyeleriYaz.mock.invocationCallOrder[0]).toBeLessThan(svc.hucreleriYaz.mock.invocationCallOrder[0]!);
  });

  it("⭐ arşivli profil salt okunur: radyolar pasif, Kaydet yok", async () => {
    svc.liste.mockResolvedValue({ items: [prof("p-x", "Eski", { arsivlendi: "2026-10-01T00:00:00Z", hucreler: [{ tur: "fason.donus-gecikti", durum: "ACIK" }] })] });
    renderWithProviders(<NotificationProfilesPage />);
    expect(await screen.findByLabelText("Fason dönüşü gecikti: Açık")).toBeDisabled();
    expect(screen.getByText(/matris salt okunur/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
  });

  it("izinsiz üye uyarısı yalnız bilgi satırıdır", async () => {
    svc.liste.mockResolvedValue({ items: [{ ...A, izinsizUyeler: { "fason.donus-gecikti": 2 } }] });
    renderWithProviders(<NotificationProfilesPage />);
    expect(await screen.findByText(/Bu türü 2 üye alamaz: izinleri yok/)).toBeInTheDocument();
  });
});

describe("arşivleme", () => {
  it("⭐ üyesi olan profilde Arşivle pasif ve üyeler listelenir", async () => {
    renderWithProviders(<NotificationProfilesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Arşivle/ }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/3 üyesi var/)).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Arşivle" })).toBeDisabled();
    expect(svc.arsivle).not.toHaveBeenCalled();
  });
});

describe("yeni profil", () => {
  it("⭐ belirsiz hatada (ağ) aynı clientToken; kesin 4xx sonrası yeni token", async () => {
    const netErr = Object.assign(new Error("Network Error"), { isAxiosError: true, request: {} });
    const badReq = Object.assign(new Error("400"), { isAxiosError: true, response: { status: 400, data: { message: "Profil kodu zorunlu." } } });
    svc.olustur.mockRejectedValueOnce(netErr).mockRejectedValueOnce(badReq).mockRejectedValueOnce(badReq);
    renderWithProviders(<ProfileFormDialog open onOpenChange={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText("Ad"), { target: { value: "Vardiya" } });
    fireEvent.change(screen.getByLabelText("Kod"), { target: { value: "vrd" } });
    const submit = screen.getByRole("button", { name: "Oluştur" });
    for (let i = 1; i <= 3; i++) {
      fireEvent.click(submit);
      await waitFor(() => expect(svc.olustur).toHaveBeenCalledTimes(i));
      await waitFor(() => expect(submit).not.toBeDisabled());
    }
    const tokens = svc.olustur.mock.calls.map((c) => c[0].clientToken);
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[2]).not.toBe(tokens[1]);
    expect(svc.olustur.mock.calls[0]![0].kod).toBe("VRD");
  });
});
