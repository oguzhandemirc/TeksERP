// BEKÇİ — Patron Bulutu "Kilitle" (B6): düğme yalnız AKTIF hesapta; onayla istek gider; işlem kimliği
//   mantıksal deneme başına BİR kez — belirsiz hatada (503/ağ) AYNI kimlikle tekrar, kesin 4xx'te YENİ kimlik.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const status = vi.fn();
const lock = vi.fn();
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  patronCloudService: { status: () => status(), activate: vi.fn(), lock: (...a: unknown[]) => lock(...a) },
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { PatronCloudPage } from "./PatronCloudPage";

const hesap = (id: string, ad: string, durum: "AKTIF" | "KILITLI" | "DAVETLI") => ({ id, ad, eposta: `${id}@ornek.test`, durum, sonGiris: null });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><PatronCloudPage /></MemoryRouter></QueryClientProvider>);
}

const httpHata = (s: number) => Object.assign(new Error(`HTTP ${s}`), { response: { status: s, data: { success: false, message: "ret" } } });

beforeEach(() => {
  status.mockReset().mockResolvedValue({
    etkin: true, teknikKullanici: null, uygunluk: { ok: true, neden: null }, adres: "varsayilan",
    hesaplar: [hesap("a1", "Ayşe Patron", "AKTIF"), hesap("k1", "Kilitli Kişi", "KILITLI"), hesap("d1", "Davetli", "DAVETLI")],
    hesaplarAlinma: null, sonTur: null,
  });
  lock.mockReset();
});

describe("PatronCloudPage — bulut hesabını kilitle", () => {
  it("⭐ Kilitle düğmesi yalnız AKTIF hesapta", async () => {
    renderPage();
    await screen.findByText("Ayşe Patron");
    expect(screen.getAllByRole("button", { name: /Kilitle/ })).toHaveLength(1);
  });

  it("⭐ belirsiz hatada (503) aynı işlem kimliği, kesin 4xx'ten sonra yeni kimlik", async () => {
    const user = userEvent.setup();
    lock.mockRejectedValueOnce(httpHata(503)).mockRejectedValueOnce(httpHata(409)).mockResolvedValueOnce({ data: hesap("a1", "Ayşe Patron", "KILITLI") });
    renderPage();
    const onayla = async () => {
      await user.click(await screen.findByRole("button", { name: /Kilitle/ }));
      await user.click(await screen.findByRole("button", { name: "Kilitle" }));
    };
    await onayla();
    await waitFor(() => expect(lock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Kilitle" }));
    await waitFor(() => expect(lock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Kilitle" }));
    await waitFor(() => expect(lock).toHaveBeenCalledTimes(3));
    const [c1, c2, c3] = lock.mock.calls as [string, string][];
    expect(c1![0]).toBe("a1");
    expect(c2![1]).toBe(c1![1]);
    expect(c3![1]).not.toBe(c2![1]);
  });
});
