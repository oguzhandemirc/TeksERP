import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UpdateStatus as PanelStatus } from "@shared/ipc-contract";
import { renderWithProviders } from "@/test/render";
import { SurumNotlariDialog } from "@/components/layout/SurumNotlariDialog";
import { SURUM_NOTLARI } from "@/lib/surum-notlari";
import { SON_GORULEN_ANAHTAR } from "@/lib/surum-notu-isaret";
import { RELEASE_NOTES_PATH } from "@/pages/ReleaseNotes/release-notes-path";
import { useSurumNotuStore } from "@/store/surum-notu";
import type { UpdateSummary } from "@/types/server-update";

/**
 * GÜNCELLEMELER SAYFASI — sunucu + bu bilgisayar TEK yerde (S1–S10).
 * ⭐ İzinsiz kullanıcı tam durumu (`/durum`, `license:*`) SORMAZ; satırı `/ozet`ten çizer ve onay düğmesi yerine
 *   "Yöneticiniz onaylayacak" görür. ⭐ Ayrıntılar varsayılan KAPALI. ⭐ "Neler yeni?" elle kipte açar.
 */
const status = vi.fn();
const summary = vi.fn();
vi.mock("@/services/serverUpdateService", () => ({ serverUpdateService: { status: () => status(), summary: () => summary(), approve: vi.fn() } }));
const perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.includes(p)) }) }));
const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: { navigateActive: unknown }) => unknown) => sel({ navigateActive }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useClientPolicy", () => ({ useClientPolicy: () => null }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
// Hedef: masaüstü varsayılan; web paneli testi kendisi çevirir ("bu bilgisayar" satırı yalnız masaüstünde).
const rt = vi.hoisted(() => ({ IS_ELECTRON: true }));
vi.mock("@/lib/runtime-env", () => rt);
const { UpdatesPage } = await import("./UpdatesPage");

const ozet = (p: Partial<UpdateSummary> = {}): UpdateSummary => ({
  kuruluSurum: "2.12.0",
  donuk: false,
  guncelleyici: { durum: "CALISIYOR" },
  bekleyen: { surum: "2.13.0", karar: "ONAY_BEKLIYOR", neden: null, zorunlu: false },
  karar: { karar: "ONAY_BEKLIYOR", neden: null },
  yerel: { durum: "HAZIR", hataKodu: null, ilerleme: null },
  son: null,
  ...p,
});

const install = vi.fn();
function panel(p: Partial<PanelStatus> | null): void {
  if (p === null) {
    delete (window as unknown as { api?: unknown }).api;
    return;
  }
  const durum: PanelStatus = { state: "up-to-date", currentVersion: "1.6.5", lastCheckedAt: null, feedUrl: "https://x/electron/", feedUrlOverridden: false, enabled: true, ...p };
  (window as unknown as { api: unknown }).api = {
    updater: { status: async () => durum, check: async () => durum, install, setFeedUrl: vi.fn(), onStatus: () => () => {} },
  };
}

beforeEach(() => {
  status.mockReset();
  summary.mockReset();
  install.mockReset();
  navigateActive.mockReset();
  perms.length = 0;
  useSurumNotuStore.setState({ acik: false, elle: false });
  panel(null);
  rt.IS_ELECTRON = true;
});
afterEach(() => panel(null));

const sunucuDurumu = async () => (await screen.findByTestId("guncelleme-durumu-sunucu")).textContent;

describe("Güncellemeler — sunucu satırı", () => {
  it("S4 ⭐ izinsiz: yalnız /ozet sorulur (/durum DEĞİL), onay düğmesi yok, 'Yöneticiniz onaylayacak'", async () => {
    summary.mockResolvedValue(ozet());
    renderWithProviders(<UpdatesPage />);
    expect(await sunucuDurumu()).toBe("Onay bekliyor — 2.13.0");
    expect(summary).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(screen.getByText("Yöneticiniz onaylayacak")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Şimdi kur" })).toBeNull();
  });

  it("S3 yetkili (license:manage): tam durum okunur, /ozet sorulmaz; düğmeler var, 'Yöneticiniz onaylayacak' YOK", async () => {
    perms.push("license:manage");
    status.mockResolvedValue({
      ...ozet(),
      eylemler: { hemen: true, pencere: true, geriAl: false, hedefSurum: "2.13.0", neden: null },
      politika: null,
      sonrakiPencere: null,
      gecmis: [],
    });
    renderWithProviders(<UpdatesPage />);
    expect(await sunucuDurumu()).toBe("Onay bekliyor — 2.13.0");
    expect(summary).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Şimdi kur" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bu gece kur" })).toBeTruthy();
    expect(screen.queryByText("Yöneticiniz onaylayacak")).toBeNull();
  });

  it("S1/S2 güncel → '✓ Güncel'; pencere bekleyen yeni sürüm → 'Yeni sürüm X' (onay notu yok)", async () => {
    summary.mockResolvedValue(ozet({ bekleyen: null, karar: { karar: "GUNCEL", neden: null } }));
    const { unmount } = renderWithProviders(<UpdatesPage />);
    expect(await sunucuDurumu()).toBe("✓ Güncel");
    unmount();
    summary.mockResolvedValue(ozet({ bekleyen: { surum: "2.13.0", karar: "PENCERE_BEKLIYOR", neden: null, zorunlu: false } }));
    renderWithProviders(<UpdatesPage />);
    expect(await sunucuDurumu()).toBe("Yeni sürüm 2.13.0");
    expect(screen.queryByText("Yöneticiniz onaylayacak")).toBeNull();
  });

  it("S6 durum okunamadı → satır yine çizilir: tek cümle + 'Yeniden dene' (tekrar sorar)", async () => {
    summary.mockRejectedValue(new Error("ağ"));
    renderWithProviders(<UpdatesPage />);
    expect(await screen.findByTestId("guncelleme-sorunu-sunucu")).toHaveTextContent("okunamadı");
    const n = summary.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    await waitFor(() => expect(summary.mock.calls.length).toBeGreaterThan(n));
  });

  it("S8 son güncelleme: tarih fabrika diliminden (UTC 00:10 → İstanbul 03:10) + sonuç işareti", async () => {
    summary.mockResolvedValue(ozet({ son: { sonuc: "BASARILI", hedefSurum: "2.12.0", bitis: "2026-10-12T00:10:00.000Z" } }));
    renderWithProviders(<UpdatesPage />);
    expect(await screen.findByTestId("son-guncelleme")).toHaveTextContent("Son güncelleme: 12.10.2026 03:10 · Sunucu 2.12.0 ✓");
  });

  it("S9 Ayrıntılar varsayılan KAPALI; tıklayınca açılır", async () => {
    summary.mockResolvedValue(ozet());
    renderWithProviders(<UpdatesPage />);
    await sunucuDurumu();
    expect(screen.queryByTestId("guncelleme-ayrintilari")).toBeNull();
    const dugme = screen.getByRole("button", { name: "Ayrıntılar" });
    expect(dugme).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(dugme);
    expect(screen.getByTestId("guncelleme-ayrintilari")).toBeTruthy();
  });
});

describe("Güncellemeler — bu bilgisayar satırı", () => {
  beforeEach(() => summary.mockResolvedValue(ozet({ bekleyen: null })));
  const panelDurumu = async () => (await screen.findByTestId("guncelleme-durumu-panel")).textContent;

  it("S7 güncel / iniyor %N: durum cümlesi tek kaynaktan, 'Yeniden başlat' YOK", async () => {
    panel({ state: "up-to-date" });
    const { unmount } = renderWithProviders(<UpdatesPage />);
    await waitFor(async () => expect(await panelDurumu()).toBe("✓ Güncel"));
    expect(screen.queryByRole("button", { name: "Yeniden başlat" })).toBeNull();
    unmount();
    panel({ state: "downloading", percent: 37 });
    renderWithProviders(<UpdatesPage />);
    await waitFor(async () => expect(await panelDurumu()).toBe("İndiriliyor %37"));
  });

  it("S7 ⭐ hazır → 'Yeniden başlat' kurulumu çağırır", async () => {
    panel({ state: "ready", newVersion: "1.6.6" });
    renderWithProviders(<UpdatesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Yeniden başlat" }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("S7 masaüstü, güncelleyici köprüsü yok: satır yine çizilir; 'Neler yeni?' Sürüm Notları sayfasına gider", async () => {
    renderWithProviders(<UpdatesPage />);
    expect(await panelDurumu()).toMatch(/en güncel sürümü yükler/);
    fireEvent.click(screen.getByRole("button", { name: "Neler yeni?" }));
    expect(navigateActive).toHaveBeenCalledWith(RELEASE_NOTES_PATH);
    expect(useSurumNotuStore.getState().acik).toBe(false);
  });

  it("⭐ web paneli: 'bu bilgisayar' satırı HİÇ çizilmez (güncelleyici yok), sunucu satırı kalır", async () => {
    rt.IS_ELECTRON = false;
    summary.mockResolvedValue(ozet());
    renderWithProviders(<UpdatesPage />);
    await sunucuDurumu();
    expect(screen.queryByTestId("guncelleme-durumu-panel")).toBeNull();
  });

  it("S10 ⭐ masaüstünde 'Neler yeni?' sürüm notu penceresini ELLE kipte açar", async () => {
    panel({ state: "up-to-date" });
    renderWithProviders(<UpdatesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Neler yeni?" }));
    expect(useSurumNotuStore.getState()).toMatchObject({ acik: true, elle: true });
    expect(navigateActive).not.toHaveBeenCalled();
  });
});

describe("S10 sürüm notu penceresi — elle açılışta boş kalmaz", () => {
  const sonPanel = SURUM_NOTLARI.find((y) => y.surumler.panel);
  afterEach(() => localStorage.removeItem(SON_GORULEN_ANAHTAR));

  it("hepsi görülmüşken: elle → kurulu sürümün son notu; otomatik → 'Gösterilecek sürüm notu yok'", async () => {
    expect(sonPanel, "panel notu olmalı").toBeTruthy();
    localStorage.setItem(SON_GORULEN_ANAHTAR, SURUM_NOTLARI[0]!.id);
    useSurumNotuStore.setState({ acik: true, elle: false });
    const { unmount } = render(<SurumNotlariDialog kuruluSurum={sonPanel!.surumler!.panel!} />);
    expect(await screen.findByText("Gösterilecek sürüm notu yok.")).toBeTruthy();
    unmount();
    useSurumNotuStore.setState({ acik: true, elle: true });
    render(<SurumNotlariDialog kuruluSurum={sonPanel!.surumler!.panel!} />);
    await waitFor(() => expect(screen.queryByText("Gösterilecek sürüm notu yok.")).toBeNull());
  });
});
