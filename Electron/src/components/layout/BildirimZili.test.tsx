// Panel bildirim zili (plan §6.1): bayrak kapalı/eski backend → DOM değişmez; rozet; klavye; boş durum;
// tümünü okundu + 6 sn geri al; okundu geri alınabilir (okunmadı yap).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { NotificationItem, NotificationListResult, NotificationSummary } from "@/lib/bildirim/types";

const durum = vi.hoisted(() => ({
  bayrak: true,
  ozet: null as unknown,
  liste: null as unknown,
  toastAction: null as null | { label: string; onClick: () => void },
}));

const svc = vi.hoisted(() => ({
  ozet: vi.fn(),
  bekle: vi.fn(() => new Promise(() => {})),
  liste: vi.fn(),
  katalog: vi.fn(async () => ({ turler: [] })),
  okundu: vi.fn(async () => ({ degisti: true })),
  okunmadi: vi.fn(async () => ({ degisti: true })),
  ertele: vi.fn(async () => ({ erteleBitis: "2026-10-26T05:00:00Z" })),
  tumunuOkundu: vi.fn(async () => ({ ids: ["a", "b"] })),
  geriAlOkundu: vi.fn(async () => ({ ids: ["a", "b"] })),
}));

vi.mock("@/services/bildirimService", () => ({
  bildirimService: svc,
  httpStatusOf: (e: unknown) => (e as { status?: number })?.status ?? null,
  notificationErrorCode: () => undefined,
}));
vi.mock("@/lib/bildirim/headers", () => ({ openBellStream: () => new Promise(() => {}) }));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { bildirimGelenKutusuEnabled: durum.bayrak } }, isSuccess: true }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn((_m: string, o?: { action?: { label: string; onClick: () => void } }) => {
      durum.toastAction = o?.action ?? null;
    }),
    error: vi.fn(),
  }),
}));
const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { navigateActive: unknown }) => unknown) => sel({ navigateActive }),
}));

function item(over: Partial<NotificationItem>): NotificationItem {
  const now = new Date().toISOString();
  return {
    id: "x", tur: "siparis.patron-siparisi", sinif: "BILDIRIM", altTur: "OLAY", grup: "Sipariş",
    baslik: "Patron siparişi geldi", govde: "", yol: "/operations/orders?focus=o1", konu: { tip: "order", id: "o1" },
    sayac: 1, ilkAn: now, sonAn: now, neden: "IZIN", okunduAn: null, erteleBitis: null, cozulduAn: null, ...over,
  };
}
const liste = (items: NotificationItem[]): NotificationListResult => ({ items, nextCursor: null, sayi: items.length, epoch: 1, rev: 1, alarmRev: 0 });

async function yukle() {
  vi.resetModules();
  const { BildirimZili } = await import("./BildirimZili");
  return renderWithProviders(<BildirimZili />);
}

function hazirla() {
  durum.bayrak = true;
  durum.toastAction = null;
  navigateActive.mockReset();
  Object.values(svc).forEach((f) => f.mockClear());
  svc.ozet.mockImplementation(async (): Promise<NotificationSummary> => ({ enabled: true, okunmamis: 12, alarmAcik: 0, epoch: 1, rev: 1, alarmRev: 0 }));
  svc.liste.mockImplementation(async () =>
    liste([item({ id: "a", baslik: "Birinci" }), item({ id: "b", baslik: "İkinci", okunduAn: new Date().toISOString(), sayac: 3 })]),
  );
}

describe("BildirimZili · görünürlük ve rozet", () => {
  beforeEach(hazirla);

  it("bayrak kapalıyken DOM değişmez ve sunucuya hiç gidilmez", async () => {
    durum.bayrak = false;
    const { container } = await yukle();
    await act(async () => {});
    expect(container.innerHTML).toBe("");
    expect(svc.ozet).not.toHaveBeenCalled();
  });

  it("eski backend (/ozet 404) → zil çizilmez", async () => {
    svc.ozet.mockRejectedValue({ status: 404 });
    const { container } = await yukle();
    await waitFor(() => expect(svc.ozet).toHaveBeenCalled());
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("rozet okunmamış sayıyı gösterir, 99 üstü 99+", async () => {
    await yukle();
    expect(await screen.findByRole("button", { name: "12 okunmamış bildirim" })).toBeTruthy();
    expect(screen.getByTestId("bildirim-rozet").textContent).toBe("12");
    svc.ozet.mockImplementation(async () => ({ enabled: true, okunmamis: 150, alarmAcik: 0, epoch: 1, rev: 1, alarmRev: 0 }));
    await yukle();
    await waitFor(() => expect(screen.getAllByTestId("bildirim-rozet").some((e) => e.textContent === "99+")).toBe(true));
  });

  it("okunmamış yoksa rozet yok", async () => {
    svc.ozet.mockImplementation(async () => ({ enabled: true, okunmamis: 0, alarmAcik: 0, epoch: 1, rev: 1, alarmRev: 0 }));
    await yukle();
    await screen.findByRole("button", { name: "Bildirimler: okunmamış yok" });
    expect(screen.queryByTestId("bildirim-rozet")).toBeNull();
  });

});

describe("BildirimZili · açılır liste ve eylemler", () => {
  beforeEach(hazirla);

  it("açılır liste: gün grubu, (+N), ok tuşlarıyla gezinme, Enter açar ve okundu yapar", async () => {
    await yukle();
    fireEvent.click(await screen.findByRole("button", { name: "12 okunmamış bildirim" }));
    const birinci = await screen.findByRole("button", { name: "Okunmamış: Birinci" });
    expect(screen.getByText("Bugün")).toBeTruthy();
    expect(screen.getByText("(+2)")).toBeTruthy();
    const ikinci = screen.getByRole("button", { name: "İkinci" });
    const kutu = birinci.closest("[role=dialog]") ?? birinci.parentElement!.parentElement!.parentElement!;
    fireEvent.keyDown(kutu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(birinci);
    fireEvent.keyDown(kutu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(ikinci);
    fireEvent.keyDown(kutu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(birinci);
    fireEvent.click(birinci);
    await waitFor(() => expect(svc.okundu).toHaveBeenCalledWith("a"));
    expect(navigateActive).toHaveBeenCalledWith("/operations/orders?focus=o1");
  });

  it("boş durum: 'Yeni bildirim yok'", async () => {
    svc.liste.mockImplementation(async () => liste([]));
    await yukle();
    fireEvent.click(await screen.findByRole("button", { name: "12 okunmamış bildirim" }));
    expect(await screen.findByText("Yeni bildirim yok")).toBeTruthy();
  });

  it("tümünü okundu say onaysız çalışır; 6 sn tostundaki Geri al aynı kimlikleri geri alır", async () => {
    await yukle();
    fireEvent.click(await screen.findByRole("button", { name: "12 okunmamış bildirim" }));
    fireEvent.click(await screen.findByRole("button", { name: /Tümünü okundu say/ }));
    await waitFor(() => expect(svc.tumunuOkundu).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(durum.toastAction?.label).toBe("Geri al"));
    act(() => durum.toastAction!.onClick());
    await waitFor(() => expect(svc.geriAlOkundu).toHaveBeenCalledWith(["a", "b"]));
  });

  it("okundu geri alınabilir: okunmuş satırda 'Okunmadı yap'", async () => {
    await yukle();
    fireEvent.click(await screen.findByRole("button", { name: "12 okunmamış bildirim" }));
    await screen.findByRole("button", { name: "İkinci" });
    fireEvent.click(screen.getByRole("button", { name: "Okunmadı yap" }));
    await waitFor(() => expect(svc.okunmadi).toHaveBeenCalledWith("b"));
  });

  it("'Tüm bildirimler' sayfaya götürür", async () => {
    await yukle();
    fireEvent.click(await screen.findByRole("button", { name: "12 okunmamış bildirim" }));
    fireEvent.click(await screen.findByRole("button", { name: /Tüm bildirimler/ }));
    expect(navigateActive).toHaveBeenCalledWith("/notifications");
  });
});
