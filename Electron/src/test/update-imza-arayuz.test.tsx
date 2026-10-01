import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import type { UpdateStatus } from "@shared/ipc-contract";
import { DEFAULT_UPDATE_FEED_URL } from "@shared/update-feed";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import { UpdateSection } from "@/pages/GeneralSettings/UpdateSection";
import { UpdateSecurityStrip } from "@/components/layout/UpdateSecurityStrip";

/**
 * GÜNCELLEME GÜVENLİĞİ — ARAYÜZ.
 * ⭐ İmza reddi (kurulmayan güncelleme) KABUKTA şeritle ve Güncelleme ekranında tehlike tonuyla görünür;
 *   ağ hatası gibi gizlenmez (indirme şeridinin "hata gösterme" kuralının bilinçli istisnası).
 * ⭐ Güncelleme adresi ezmesi YALNIZ `admin:settings`: ekran `settings:workstation`a da açıktır ama o kişi
 *   adresi DEĞİŞTİREMEZ. Girilen adres ana süreçle AYNI kuraldan (`validateFeedOverride`) geçer; http RED.
 */
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useClientPolicy", () => ({ useClientPolicy: () => null }));

const setFeedUrl = vi.fn(async (_u: string | null) => durum);
let durum: UpdateStatus;

function kur(patch: Partial<UpdateStatus>, izinler: string[]) {
  durum = {
    state: "up-to-date",
    currentVersion: "1.4.3",
    lastCheckedAt: null,
    feedUrl: DEFAULT_UPDATE_FEED_URL,
    feedUrlOverridden: false,
    enabled: true,
    imzaReddi: null,
    ...patch,
  };
  (window as unknown as { api: unknown }).api = {
    updater: {
      status: async () => durum,
      check: async () => durum,
      install: vi.fn(),
      setFeedUrl,
      onStatus: () => () => {},
    },
  };
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: izinler } as unknown as JwtPayload });
}

beforeEach(() => {
  setFeedUrl.mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  useAuthStore.setState({ user: null });
});

const RED = { kod: "JWS_IMZA", surum: "1.4.4", zaman: "2026-10-01T01:00:00.000Z" };

describe("imza reddi görünür", () => {
  it("şerit: red yoksa hiç çizilmez; varsa sürüm + kod ile uyarı (role=alert)", async () => {
    kur({}, ["admin:settings"]);
    const { unmount } = render(<UpdateSecurityStrip />);
    await waitFor(() => expect(screen.queryByTestId("guncelleme-imza-reddi")).toBeNull());
    unmount();
    kur({ state: "error", error: "Sunulan güncellemenin imzası doğrulanamadı; güvenlik nedeniyle kurulmadı.", imzaReddi: RED }, ["roll:read"]);
    render(<UpdateSecurityStrip />);
    const serit = await screen.findByRole("alert");
    expect(serit).toHaveTextContent("KURULMADI");
    expect(serit).toHaveTextContent("1.4.4");
    expect(serit).toHaveTextContent("JWS_IMZA");
  });

  it("Güncelleme ekranı: red metni + kod", async () => {
    kur({ state: "error", error: "Sunulan güncellemenin imzası doğrulanamadı; güvenlik nedeniyle kurulmadı.", imzaReddi: RED }, ["settings:workstation"]);
    render(<UpdateSection />);
    expect(await screen.findByText(/imzası doğrulanamadı.*\(JWS_IMZA\)/)).toBeInTheDocument();
  });
});

describe("güncelleme adresi ezmesi — yalnız admin:settings", () => {
  it("settings:workstation adresi GÖRÜR ama değiştiremez", async () => {
    kur({}, ["settings:workstation"]);
    render(<UpdateSection />);
    expect(await screen.findByText(DEFAULT_UPDATE_FEED_URL)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Değiştir" })).toBeNull();
  });

  it("admin: http adresi RED (ana süreçle aynı kural), izinli adres normalize edilip gönderilir", async () => {
    kur({}, ["admin:settings"]);
    const user = userEvent.setup();
    render(<UpdateSection />);
    await user.click(await screen.findByRole("button", { name: "Değiştir" }));
    const kutu = screen.getByPlaceholderText(/electron/);
    await user.type(kutu, DEFAULT_UPDATE_FEED_URL.replace("https:", "http:"));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/https/));
    expect(setFeedUrl).not.toHaveBeenCalled();
    await user.clear(kutu);
    await user.type(kutu, DEFAULT_UPDATE_FEED_URL.slice(0, -1));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(setFeedUrl).toHaveBeenCalledWith(DEFAULT_UPDATE_FEED_URL));
  });
});
