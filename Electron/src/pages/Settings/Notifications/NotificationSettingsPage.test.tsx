// Bildirim tercihleri sayfası (N4-PANEL): liste YALNIZ sunucu hücrelerinden (istemci süzme yok) · kilitli
// satırda "Kapalı" yok · Kaydet tam gövde PUT + cevaptan yeniden kurar · 409 kilit → satır kilitli + tost ·
// eski sunucu (404) → açıklama, çökme yok · bayrak kapalı → "Bildirimler kapalı" · saat notu fabrika dilimi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { setFactoryTimezone } from "@/lib/factory-time";
import { factoryClockNote } from "./QuietHoursCard";

const d = vi.hoisted(() => ({ bayrak: true, status: null as number | null, kod: undefined as string | undefined, tur: undefined as string | undefined }));
const kanal = (k: string, durum: string, kilit = false, kaynak = "katalog") => ({ kanal: k, durum, kilit, kaynak, kapsam: null });
const svc = vi.hoisted(() => ({
  katalog: vi.fn(),
  tercihler: vi.fn(),
  tercihleriYaz: vi.fn(),
  ayarlar: vi.fn(async () => ({ sessizBaslangic: null, sessizBitis: null, sessizKanallar: [], ozetSaati: null, ses: true })),
  ayarlariYaz: vi.fn(),
  tercihOnizleme: vi.fn(async () => ({ haftalik: 12.4, enCok: [{ kind: "siparis.patron-siparisi", sayi: 9 }], kaynak: "olcum" })),
  varsayilanaDonOnizleme: vi.fn(async () => ({
    satirlar: [
      { id: "r1", tur: "siparis.patron-siparisi", ad: "Yönetim bulutundan sipariş geldi", kanal: "MASAUSTU", acik: true, kapsam: null },
      { id: "r2", tur: "sistem.yedek-basarisiz", ad: "Gece yedeği alınamadı", kanal: "MASAUSTU", acik: true, kapsam: null },
    ],
  })),
  varsayilanaDon: vi.fn(async () => ({ silinen: 1 })),
}));
vi.mock("@/services/bildirimService", () => ({
  bildirimService: svc,
  httpStatusOf: () => d.status,
  notificationErrorCode: () => d.kod,
  notificationErrorDetail: () => d.tur,
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { bildirimGelenKutusuEnabled: d.bayrak } }, isSuccess: true }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

const TURLER = [
  { kod: "siparis.patron-siparisi", ad: "Yönetim bulutundan sipariş geldi", sinif: "BILDIRIM", altTur: "OLAY", grup: "Sipariş", kilit: "YOK", kilitGerekcesi: null },
  { kod: "sistem.yedek-basarisiz", ad: "Gece yedeği alınamadı", sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem", kilit: "HER_ZAMAN", kilitGerekcesi: "Veri kaybı riski" },
  { kod: "kalite.ret", ad: "Kalite reddi", sinif: "BILDIRIM", altTur: "OLAY", grup: "Kalite", kilit: "YOK", kilitGerekcesi: null },
];
const HUCRELER = [
  { kind: "siparis.patron-siparisi", kanallar: [kanal("UYGULAMA", "ACIK"), kanal("OZET", "KAPALI"), kanal("MASAUSTU", "KAPALI")] },
  { kind: "sistem.yedek-basarisiz", kanallar: [kanal("UYGULAMA", "ACIK", true), kanal("OZET", "KAPALI"), kanal("MASAUSTU", "KAPALI")] },
];

import { NotificationSettingsPage } from "./NotificationSettingsPage";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(d, { bayrak: true, status: null, kod: undefined, tur: undefined });
  svc.katalog.mockResolvedValue({ turler: TURLER, hucreler: HUCRELER, yetkiDisi: 2 });
  svc.tercihler.mockResolvedValue({ hucreler: HUCRELER, satirlar: [] });
});

describe("NotificationSettingsPage", () => {
  it("yalnız sunucunun çözdüğü türler listelenir; kilitli satırda Kapalı yok; yetki dışı sayısı görünür", async () => {
    renderWithProviders(<NotificationSettingsPage />);
    const kilitli = await screen.findByTestId("tur-sistem.yedek-basarisiz");
    expect(screen.queryByTestId("tur-kalite.ret")).toBeNull(); // katalogda var, hücresi yok → çizilmez
    expect(within(kilitli).queryByRole("radio", { name: "Kapalı" })).toBeNull();
    expect(within(kilitli).getByText(/Neden kilitli/)).toBeTruthy();
    const acik = screen.getByTestId("tur-siparis.patron-siparisi");
    expect(within(acik).getByRole("radio", { name: "Kapalı" })).toBeTruthy();
    expect(screen.getByTestId("yetki-disi").textContent).toContain("2 tür yetkiniz dışında");
  });

  it("Kaydet tam gövde PUT yollar ve formu CEVAPTAN kurar", async () => {
    svc.tercihleriYaz.mockResolvedValue({
      hucreler: [{ ...HUCRELER[0], kanallar: [kanal("UYGULAMA", "KAPALI", false, "kullanici"), kanal("OZET", "KAPALI"), kanal("MASAUSTU", "KAPALI")] }, HUCRELER[1]],
      satirlar: [],
    });
    renderWithProviders(<NotificationSettingsPage />);
    const satir = await screen.findByTestId("tur-siparis.patron-siparisi");
    fireEvent.click(within(satir).getByRole("radio", { name: "Kapalı" }));
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(svc.tercihleriYaz).toHaveBeenCalledTimes(1));
    const body = svc.tercihleriYaz.mock.calls[0]![0] as Array<{ tur: string; kanal: string; acik: boolean }>;
    expect(body).toHaveLength(6);
    expect(body).toContainEqual({ tur: "siparis.patron-siparisi", kanal: "UYGULAMA", acik: false });
    expect(body).toContainEqual({ tur: "sistem.yedek-basarisiz", kanal: "UYGULAMA", acik: true });
    await waitFor(() => expect(screen.getByText(/Sizin seçiminiz/)).toBeTruthy());
  });

  it("409 NOTIFICATION_KIND_LOCKED → satır kilitli gösterilir + tost", async () => {
    svc.tercihleriYaz.mockRejectedValue(new Error("409"));
    Object.assign(d, { kod: "NOTIFICATION_KIND_LOCKED", tur: "siparis.patron-siparisi" });
    renderWithProviders(<NotificationSettingsPage />);
    const satir = await screen.findByTestId("tur-siparis.patron-siparisi");
    fireEvent.click(within(satir).getByRole("radio", { name: "Kapalı" }));
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("kilitlendi")));
    expect(within(screen.getByTestId("tur-siparis.patron-siparisi")).queryByRole("radio", { name: "Kapalı" })).toBeNull();
  });

  it("eski sunucu (404) → açıklama, çökme yok", async () => {
    svc.tercihler.mockRejectedValue(new Error("404"));
    d.status = 404;
    renderWithProviders(<NotificationSettingsPage />);
    expect(await screen.findByText("Sunucu bu ekranı henüz desteklemiyor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Kaydet/ })).toBeNull();
  });

  it("bayrak kapalı → Bildirimler kapalı; uç çağrılmaz", async () => {
    d.bayrak = false;
    renderWithProviders(<NotificationSettingsPage />);
    expect(await screen.findByText("Bildirimler kapalı")).toBeTruthy();
    expect(svc.tercihler).not.toHaveBeenCalled();
  });

  it("saat notu fabrika diliminden (bilgisayarın yerel saati değil)", () => {
    setFactoryTimezone("Asia/Tokyo");
    try {
      expect(factoryClockNote(new Date("2026-10-25T00:30:00Z"))).toBe("Saatler fabrika saatiyle (Asia/Tokyo); fabrikada şu an 09:30.");
    } finally {
      setFactoryTimezone("Europe/Istanbul");
    }
  });

  it("önizleme sunucudan: haftalık sayı + en çok + ölçüm etiketi (istemci hesaplamaz)", async () => {
    renderWithProviders(<NotificationSettingsPage />);
    const serit = await screen.findByTestId("onizleme-serit", {}, { timeout: 3000 });
    expect(serit.textContent).toContain("~12 bildirim");
    expect(serit.textContent).toContain("en çok: Yönetim bulutundan sipariş geldi 9");
    expect(serit.textContent).toContain("ölçüm");
    expect(svc.tercihOnizleme).toHaveBeenCalledWith(expect.arrayContaining([{ tur: "siparis.patron-siparisi", kanal: "UYGULAMA", acik: true }]));
  });

  it("Varsayılana dön: sapma satırları listelenir, yalnız SEÇİLENLER gönderilir", async () => {
    renderWithProviders(<NotificationSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Varsayılana dön/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Gece yedeği alınamadı");
    fireEvent.click(within(dialog).getAllByRole("checkbox")[1]!);
    fireEvent.click(within(dialog).getByRole("button", { name: /1 tercihi varsayılana döndür/ }));
    await waitFor(() => expect(svc.varsayilanaDon).toHaveBeenCalledWith(["r1"]));
  });
});
