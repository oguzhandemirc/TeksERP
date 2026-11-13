// BEKÇİ — Patron Bulutu fabrika seddi (G1): anahtar kapatma isteği, yalnız değişen tavanın gönderilmesi,
//   durdurulmuş/tavan dolu uyarısı, sayaçlar ve "Buluttan gelenler" makbuz listesi.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PatronCloudStatus } from "./service";

const status = vi.fn();
const updateGuard = vi.fn();
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  patronCloudService: { status: () => status(), activate: vi.fn(), lock: vi.fn(), updateGuard: (...a: unknown[]) => updateGuard(...a) },
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { PatronCloudPage } from "./PatronCloudPage";

function durum(over: Partial<PatronCloudStatus["sed"]["ayarlar"]> = {}, dolu: "SAATLIK" | "GUNLUK" | null = null): PatronCloudStatus {
  const ayarlar = { gelenKutusuAcik: true, saatlikTavan: 60, gunlukTavan: 300, raporSaatlikTavan: 60, ...over };
  return {
    etkin: true, teknikKullanici: null, uygunluk: { ok: true, neden: null }, adres: "varsayilan",
    hesaplar: [], hesaplarAlinma: null, sonTur: null,
    sed: {
      ayarlar,
      gelenKutusu: { saatlik: { sayi: dolu === "SAATLIK" ? 60 : 3, tavan: 60 }, gunluk: { sayi: 12, tavan: 300 }, kalan: dolu ? 0 : 57, dolu },
      rapor: { sonSaat: 2, tavan: 60, enAzAralikSn: 30, sonYoklama: null },
    },
    makbuzlar: [
      { id: "m1", at: "2026-11-13T09:00:00.000Z", tur: "SIPARIS", sonuc: "ISLENDI", hesapAdi: "Ayşe Patron", belgeNo: "SIP-0042", varlikId: "o1", kod: null, mesaj: "Sipariş oluşturuldu" },
      { id: "m2", at: "2026-11-13T08:00:00.000Z", tur: "CARI", sonuc: "REDDEDILDI", hesapAdi: "Ayşe Patron", belgeNo: null, varlikId: null, kod: "CARI_AD_MUKERRER", mesaj: "Aynı adda cari var" },
    ],
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><PatronCloudPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  status.mockReset().mockResolvedValue(durum());
  updateGuard.mockReset().mockResolvedValue({ data: durum(), message: "ok" });
});

describe("PatronCloudPage — fabrika seddi", () => {
  it("⭐ anahtar kapatılınca yalnız gelenKutusuAcik:false gider", async () => {
    const user = userEvent.setup();
    renderPage();
    const sw = await screen.findByRole("switch", { name: "Buluttan yazma" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    await user.click(sw);
    await waitFor(() => expect(updateGuard).toHaveBeenCalledWith({ gelenKutusuAcik: false }));
  });

  it("⭐ yalnız değişen tavan sayı olarak gönderilir; değişmeden düğme kapalı", async () => {
    const user = userEvent.setup();
    renderPage();
    const kaydet = await screen.findByRole("button", { name: "Tavanları kaydet" });
    expect(kaydet).toBeDisabled();
    const saatlik = screen.getByLabelText("Saatlik kayıt tavanı");
    await user.clear(saatlik);
    await user.type(saatlik, "25");
    await user.click(kaydet);
    await waitFor(() => expect(updateGuard).toHaveBeenCalledWith({ saatlikTavan: 25 }));
  });

  it("durdurulmuş ve tavan dolu uyarıları, sayaçlar", async () => {
    status.mockResolvedValueOnce(durum({ gelenKutusuAcik: false }));
    const { unmount } = renderPage();
    expect(await screen.findByText("Buluttan yazma durduruldu")).toBeInTheDocument();
    unmount();
    status.mockResolvedValueOnce(durum({}, "SAATLIK"));
    renderPage();
    expect(await screen.findByText("Tavan doldu")).toBeInTheDocument();
    expect(within(screen.getByTestId("guard-counters")).getByText("60 / 60")).toBeInTheDocument();
  });

  it("⭐ Buluttan gelenler sekmesi makbuzları listeler", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Buluttan gelenler" }));
    expect(await screen.findByText("SIP-0042")).toBeInTheDocument();
    expect(screen.getByText("Reddedildi")).toBeInTheDocument();
    expect(screen.getByText("Aynı adda cari var")).toBeInTheDocument();
  });

  it("⭐ makbuz araması Türkçe katlamalı süzer; eşleşme yoksa boş durum", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Buluttan gelenler" }));
    const kutu = await screen.findByRole("searchbox");
    await user.type(kutu, "AYNI ADDA");
    await waitFor(() => expect(screen.queryByText("SIP-0042")).not.toBeInTheDocument());
    expect(screen.getByText("Aynı adda cari var")).toBeInTheDocument();
    await user.clear(kutu);
    await user.type(kutu, "yok-boyle-kayit");
    expect(await screen.findByText("Eşleşen kayıt yok")).toBeInTheDocument();
  });
});
