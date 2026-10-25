// Bildirimler sayfası (plan §6.2): bayrak kapalı → "kapalı — Genel Ayarlar'dan açılır"; süzme SUNUCUDA
// (`sekme`, `filter[tur]`); toplu okundu geri alınabilir.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { NotificationItem } from "@/lib/bildirim/types";

const durum = vi.hoisted(() => ({ bayrak: true, toastAction: null as null | { onClick: () => void } }));
const svc = vi.hoisted(() => ({
  ozet: vi.fn(async () => ({ enabled: true, okunmamis: 1, alarmAcik: 0, epoch: 1, rev: 1, alarmRev: 0 })),
  bekle: vi.fn(() => new Promise(() => {})),
  liste: vi.fn(),
  katalog: vi.fn(async () => ({
    turler: [
      { kod: "sistem.yedek-basarisiz", ad: "Yedek", sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem", kilit: "HER_ZAMAN", kilitGerekcesi: null },
      { kod: "siparis.termin-gecti", ad: "Termin", sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sipariş", kilit: "YOK", kilitGerekcesi: null },
    ],
  })),
  okundu: vi.fn(async () => ({ degisti: true })),
  okunmadi: vi.fn(async () => ({ degisti: true })),
  ertele: vi.fn(),
  tumunuOkundu: vi.fn(async () => ({ ids: [] })),
  geriAlOkundu: vi.fn(async () => ({ ids: [] })),
}));
vi.mock("@/services/bildirimService", () => ({
  bildirimService: svc,
  httpStatusOf: () => null,
  notificationErrorCode: () => undefined,
}));
vi.mock("@/lib/bildirim/headers", () => ({ openBellStream: () => new Promise(() => {}) }));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { bildirimGelenKutusuEnabled: durum.bayrak } }, isSuccess: true }),
}));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn((_m: string, o?: { action?: { onClick: () => void } }) => void (durum.toastAction = o?.action ?? null)),
    error: vi.fn(),
  }),
}));
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { navigateActive: unknown }) => unknown) => sel({ navigateActive: vi.fn() }),
}));

const it1: NotificationItem = {
  id: "11111111-1111-4111-8111-111111111111", tur: "sistem.yedek-basarisiz", sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem",
  baslik: "Gece yedeği alınamadı", govde: "Disk dolu", yol: "/system/backups", konu: { tip: "yedek", id: "gece" }, sayac: 1,
  ilkAn: new Date().toISOString(), sonAn: new Date().toISOString(), neden: "IZIN", okunduAn: null, erteleBitis: null, cozulduAn: null,
};

async function yukle() {
  vi.resetModules();
  const { NotificationsPage } = await import("./NotificationsPage");
  return renderWithProviders(<NotificationsPage />);
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    durum.bayrak = true;
    durum.toastAction = null;
    Object.values(svc).forEach((f) => f.mockClear());
    svc.liste.mockImplementation(async () => ({ items: [it1], nextCursor: null, sayi: 1, epoch: 1, rev: 1, alarmRev: 0 }));
  });

  it("bayrak kapalı → sayfa kaybolmaz, 'kapalı — Genel Ayarlar'dan açılır' der", async () => {
    durum.bayrak = false;
    await yukle();
    expect(screen.getByText("Bildirimler kapalı")).toBeTruthy();
    expect(screen.getByText(/Genel Ayarlar'dan açılır/)).toBeTruthy();
    expect(svc.liste).not.toHaveBeenCalled();
  });

  it("liste + özet şeridi sunucu sayısından; alan süzgeci sunucuya `turler` olarak gider", async () => {
    await yukle();
    expect(await screen.findByText("Gece yedeği alınamadı")).toBeTruthy();
    expect(svc.liste).toHaveBeenLastCalledWith(expect.objectContaining({ sekme: "tumu", turler: [] }));
    fireEvent.click(await screen.findByRole("button", { name: /Sistem/ }));
    await waitFor(() =>
      expect(svc.liste).toHaveBeenLastCalledWith(expect.objectContaining({ turler: ["sistem.yedek-basarisiz"] })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Okunmamış" }));
    await waitFor(() => expect(svc.liste).toHaveBeenLastCalledWith(expect.objectContaining({ sekme: "okunmamis" })));
  });

  it("seçilenleri okundu say → geri al aynı kimlikleri okunmamış yapar", async () => {
    await yukle();
    await screen.findByText("Gece yedeği alınamadı");
    fireEvent.click(screen.getByRole("checkbox", { name: "Seç: Gece yedeği alınamadı" }));
    fireEvent.click(screen.getByRole("button", { name: /Seçilenleri okundu say/ }));
    await waitFor(() => expect(svc.okundu).toHaveBeenCalledWith(it1.id));
    await waitFor(() => expect(durum.toastAction).not.toBeNull());
    act(() => durum.toastAction!.onClick());
    await waitFor(() => expect(svc.geriAlOkundu).toHaveBeenCalledWith([it1.id]));
  });

  it("ALARM satırında gelen kutusu ertelemesi yok; BİLDİRİM satırında var", async () => {
    const alarm: NotificationItem = { ...it1, id: "22222222-2222-4222-8222-222222222222", tur: "dokuma.tezgah-alarmi", sinif: "ALARM", altTur: "OLAY", grup: "Dokuma", baslik: "Tezgah alarmı: T-07" };
    svc.liste.mockImplementation(async () => ({ items: [it1, alarm], nextCursor: null, sayi: 2, epoch: 1, rev: 1, alarmRev: 1 }));
    await yukle();
    await screen.findByText("Tezgah alarmı: T-07");
    expect(screen.getAllByRole("button", { name: "Ertele" })).toHaveLength(1);
  });
});
