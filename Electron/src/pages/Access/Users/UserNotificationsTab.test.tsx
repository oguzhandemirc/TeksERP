// =============================================================================
// KİŞİ KARTI → BİLDİRİMLER (2026-11-19) — gizli tür pasif + gerekçe · anahtar PUT DELTA gövdesi (tek hücre) ·
// "Varsayılana dön" `acik:null` · kilitli tür anahtarı pasif · izinsiz yöneticide sekme yok.
// NEGATİF SONDA (2026-11-19, md5 geri): diyalogdaki `canNotifications &&` kapısı kaldırıldı → "izinsiz sekme yok" ❌.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { UserPrefSummary } from "@/services/bildirimProfilService";
import type { AdminUserListItem } from "@/services/adminUserService";

const svc = vi.hoisted(() => ({ kisiTercihleri: vi.fn(), kisiTercihleriYaz: vi.fn() }));
vi.mock("@/services/bildirimProfilService", () => ({ bildirimProfilService: svc }));
const perms = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    isAdmin: false,
    hasPermission: (p: string) => perms.list.includes(p),
    hasAnyPermission: (ps: readonly string[]) => ps.some((p) => perms.list.includes(p)),
  }),
}));
// Diyalogdaki diğer sekmeler bu testin konusu değil; ağ çağrısı yapmasınlar.
vi.mock("./PermissionsTab", () => ({ PermissionsTab: () => null }));
vi.mock("./ResetPasswordTab", () => ({ ResetPasswordTab: () => null }));
vi.mock("./CardTokenTab", () => ({ CardTokenTab: () => null }));
vi.mock("./QuickPinTab", () => ({ QuickPinTab: () => null }));
vi.mock("./TwoFactorTab", () => ({ TwoFactorTab: () => null }));

const { UserNotificationsTab } = await import("./UserNotificationsTab");
const { UserDetailDialog } = await import("./UserDetailDialog");

const ch = (kanal: "UYGULAMA" | "OZET", durum: "ACIK" | "KAPALI", extra: Partial<{ kilit: boolean; kaynak: string; kisisel: { acik: boolean; kapsamli: boolean } | null }> = {}) => ({
  kanal, durum, kilit: false, kaynak: "varsayilan", kisisel: null, ...extra,
});

const SUMMARY: UserPrefSummary = {
  kullanici: { id: "u1", ad: "Ali Veli", kullaniciAdi: "ali", aktif: true, sistemHesabi: false },
  tercihKilidi: { kilitli: true, profiller: ["Amirler"] },
  profiller: [{ id: "p1", ad: "Amirler", tercihKilidi: true }],
  turler: [
    { tur: "fason.donus-gecikti", ad: "Fason dönüşü gecikti", grup: "Fason", gorur: true, gizliNeden: null, kanallar: [ch("UYGULAMA", "ACIK"), ch("OZET", "KAPALI")] },
    { tur: "siparis.termin-yaklasti", ad: "Termin yaklaştı", grup: "Sipariş", gorur: true, gizliNeden: null,
      kanallar: [ch("UYGULAMA", "KAPALI", { kaynak: "kullanici", kisisel: { acik: false, kapsamli: false } })] },
    { tur: "sistem.yedek-basarisiz", ad: "Yedek başarısız", grup: "Sistem", gorur: true, gizliNeden: null, kanallar: [ch("UYGULAMA", "ACIK", { kilit: true })] },
    { tur: "kalite.sertifika-suresi-doluyor", ad: "Sertifika süresi doluyor", grup: "Kalite", gorur: false,
      gizliNeden: "Kişinin bu türü görme yetkisi yok (gerekli: Sertifika görüntüleme).", kanallar: [] },
  ],
};

beforeEach(() => {
  perms.list = ["settings:notifications"];
  svc.kisiTercihleri.mockReset().mockResolvedValue(SUMMARY);
  svc.kisiTercihleriYaz.mockReset().mockResolvedValue(SUMMARY);
});

describe("UserNotificationsTab", () => {
  it("göremediği tür pasif ve gerekçesi yazılı; kilit şeridi görünür", async () => {
    renderWithProviders(<UserNotificationsTab userId="u1" />);
    const row = await screen.findByTestId("kisi-tur-kalite.sertifika-suresi-doluyor");
    expect(within(row).getByText(/görme yetkisi yok/)).toBeTruthy();
    expect(within(row).getByRole("switch").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Kişi kendi uygulama içi tercihlerini değiştiremez/)).toBeTruthy();
  });

  it("kilitli türün anahtarı pasif", async () => {
    renderWithProviders(<UserNotificationsTab userId="u1" />);
    const row = await screen.findByTestId("kisi-tur-sistem.yedek-basarisiz");
    expect(within(row).getByRole("switch").hasAttribute("disabled")).toBe(true);
    expect(within(row).getByText(/kilitli \(kapatılamaz\)/)).toBeTruthy();
  });

  it("anahtar yalnız o hücreyi yazar (DELTA gövde)", async () => {
    renderWithProviders(<UserNotificationsTab userId="u1" />);
    const row = await screen.findByTestId("kisi-tur-fason.donus-gecikti");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => expect(svc.kisiTercihleriYaz).toHaveBeenCalledTimes(1));
    expect(svc.kisiTercihleriYaz).toHaveBeenCalledWith("u1", [{ tur: "fason.donus-gecikti", kanal: "UYGULAMA", acik: false }]);
  });

  it("Varsayılana dön kişisel satırı acik:null ile kaldırır; kişisel satırı olmayan türde düğme yok", async () => {
    renderWithProviders(<UserNotificationsTab userId="u1" />);
    const row = await screen.findByTestId("kisi-tur-siparis.termin-yaklasti");
    expect(within(screen.getByTestId("kisi-tur-fason.donus-gecikti")).queryByRole("button", { name: /Varsayılana dön/ })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: /Varsayılana dön/ }));
    await waitFor(() => expect(svc.kisiTercihleriYaz).toHaveBeenCalledWith("u1", [{ tur: "siparis.termin-yaklasti", kanal: "UYGULAMA", acik: null }]));
  });
});

describe("UserDetailDialog → Bildirimler sekmesi", () => {
  const user = { id: "u1", username: "ali", fullName: "Ali Veli" } as AdminUserListItem;

  it("bildirim yönetim izni varsa sekme görünür", () => {
    renderWithProviders(<UserDetailDialog user={user} open onOpenChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Bildirimler" })).toBeTruthy();
  });

  it("izinsiz yöneticide sekme yok", () => {
    perms.list = ["admin:users"];
    renderWithProviders(<UserDetailDialog user={user} open onOpenChange={() => {}} />);
    expect(screen.queryByRole("tab", { name: "Bildirimler" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Yetkiler" })).toBeTruthy();
  });
});
