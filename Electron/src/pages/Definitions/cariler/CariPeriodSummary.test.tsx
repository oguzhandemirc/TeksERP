// Dönem özeti: sunucunun sayıları olduğu gibi çizilir (istemci hesap yapmaz); `null` ölçü kart çizmez; hepsi `null`
// ise bölüm yok; para birimleri ayrı satır; dönem seçimi isteği yeniler.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
const { CariPeriodSummary } = await import("./CariPeriodSummary");

const kpi = (deger: number, onceki: number, degisimYuzde: number | null) => ({ deger, onceki, degisimYuzde });
const FULL = {
  donem: "ay",
  aralik: { baslangic: "2026-10-14", bitis: "2026-11-12" },
  sevk: { metre: kpi(1250.5, 1000, 25.1), irsaliye: kpi(3, 2, 50) },
  ciro: { tutarlar: [{ paraBirimi: "TRY", deger: 325684.9, onceki: 0, degisimYuzde: null }, { paraBirimi: "USD", deger: 1200, onceki: 0, degisimYuzde: null }], fiyatsizSatir: 2 },
  siparis: { adet: kpi(4, 4, 0), metre: kpi(900, 0, null) },
};

function renderIt() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CariPeriodSummary customerId="c1" /></QueryClientProvider>);
}

describe("CariPeriodSummary", () => {
  beforeEach(() => get.mockReset());

  it("sunucu değerleri çizilir; para birimi başına satır; fiyatsız satır söylenir", async () => {
    get.mockResolvedValue({ data: { data: FULL } });
    renderIt();
    expect(await screen.findByText("Sevk (brüt)")).toBeInTheDocument();
    expect(screen.getByText("1250,5 m")).toBeInTheDocument();
    expect(screen.getByText("325.684,90 TRY")).toBeInTheDocument();
    expect(screen.getByText("1.200,00 USD")).toBeInTheDocument();
    expect(screen.getByText("2 fiyatsız satır tutara girmedi")).toBeInTheDocument();
    expect(screen.getByText("900 m")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/customers/c1/period-summary", { params: { donem: "ay" } });
  });

  it("null ölçü kart çizmez; hepsi null ise bölüm yok", async () => {
    get.mockResolvedValue({ data: { data: { ...FULL, ciro: null, siparis: null } } });
    renderIt();
    expect(await screen.findByText("Sevk (brüt)")).toBeInTheDocument();
    expect(screen.queryByText("Ciro (sevk tutarı)")).toBeNull();
    expect(screen.queryByText("Alınan sipariş")).toBeNull();
  });

  it("izinsiz (üçü null) → bölüm çizilmez", async () => {
    get.mockResolvedValue({ data: { data: { ...FULL, sevk: null, ciro: null, siparis: null } } });
    renderIt();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText("Dönem özeti")).toBeNull();
  });

  it("dönem seçimi isteği yeniler", async () => {
    get.mockResolvedValue({ data: { data: FULL } });
    renderIt();
    fireEvent.click(await screen.findByRole("radio", { name: "Hafta" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/customers/c1/period-summary", { params: { donem: "hafta" } }));
  });
});
