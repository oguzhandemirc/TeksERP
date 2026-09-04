// =============================================================================
// BEKÇİ — multi-lookup `sentinelOption`: KATALOGDA OLMAYAN seçenek (2026-09-04)
// =============================================================================
// ⭐ SINIF: "gerçek ama adı olmayan küme". `Sack.customerId` OPSİYONELDİR; canlı
//    ölçümde (tekserp_demo, 2026-09-04) depodaki 9 çuvalın 4'ü müşterisizdi.
//    Süzgeç yalnız cari KATALOĞUNU listelediği sürece bu %44'lük küme hiçbir
//    yüzeyden süzülemiyordu — "sessizce düşen satır" sınıfının kardeşi.
// ⭐ TETİK YAZISI DA ÖLÇÜLÜR: sentinel `items` içinde bulunmadığı için etiket
//    çözümü elle yapılmazsa düğme ham değeri ("none") basar.
// ⭐ ARAMA YAZILINCA SENTİNEL GİZLENİR: (a) backend `listSackCustomers` da aynı
//    kuralı uygular; (b) cmdk `shouldFilter={false}` ile çalıştığı için sabit
//    satır listede kaldığı sürece "Sonuç yok." HİÇ çizilmez → boş arama dolu
//    görünür.
// =============================================================================
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { FilterBar, type FilterDef } from "./FilterBar";

function renderBar(ui: ReactElement, url = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

const getAll = vi.fn();
const service = { getAll: (...a: unknown[]) => getAll(...a) } as never;

const DEF: FilterDef = {
  kind: "multi-lookup",
  key: "customerId",
  label: "Müşteri",
  service,
  queryKey: "customers",
  sentinelOption: { value: "none", label: "Müşterisiz (genel stok)" },
};

beforeEach(() => {
  getAll.mockReset();
  getAll.mockResolvedValue({
    data: [{ id: "c1", name: "ALFA TEKS" }],
    pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
  });
});

describe("multi-lookup sentinelOption", () => {
  it("⭐ sentinel listede ve katalog satırlarının ÜSTÜNDE çizilir", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={[DEF]} />);
    await user.click(screen.getByRole("button", { name: /Müşteri/ }));
    const sentinel = await screen.findByText("Müşterisiz (genel stok)");
    const catalog = await screen.findByText("ALFA TEKS");
    expect(sentinel).toBeTruthy();
    // DOM sırası: sentinel önce.
    expect(sentinel.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("⭐ seçili sentinel tetik yazısında ETİKETİYLE görünür (ham 'none' DEĞİL)", async () => {
    renderBar(<FilterBar filters={[DEF]} />, "/?filter%5BcustomerId%5D=none");
    expect(await screen.findByRole("button", { name: /Müşterisiz \(genel stok\)/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^none$/ })).toBeNull();
  });

  it("sentinel seçimi URL'e sentinel DEĞERİNİ yazar", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={[DEF]} />);
    await user.click(screen.getByRole("button", { name: /Müşteri/ }));
    await user.click(await screen.findByText("Müşterisiz (genel stok)"));
    // Seçimden sonra tetik etiketi sentinel etiketine döner (URL yazıldı).
    expect(await screen.findByRole("button", { name: /Müşterisiz \(genel stok\)/ })).toBeTruthy();
  });

  it("⭐ arama yazılınca sentinel GİZLENİR (yoksa 'Sonuç yok.' hiç çizilmez)", async () => {
    const user = userEvent.setup();
    getAll.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } });
    renderBar(<FilterBar filters={[DEF]} />);
    await user.click(screen.getByRole("button", { name: /Müşteri/ }));
    expect(await screen.findByText("Müşterisiz (genel stok)")).toBeTruthy();
    await user.type(screen.getByPlaceholderText(/Müşteri ara/), "zzz");
    expect(await screen.findByText("Sonuç yok.")).toBeTruthy();
    expect(screen.queryByText("Müşterisiz (genel stok)")).toBeNull();
  });

  it("sentinelOption VERİLMEZSE hiçbir sabit satır çizilmez (mevcut filtreler etkilenmez)", async () => {
    const user = userEvent.setup();
    const plain: FilterDef = { ...DEF, sentinelOption: undefined };
    renderBar(<FilterBar filters={[plain]} />);
    await user.click(screen.getByRole("button", { name: /Müşteri/ }));
    expect(await screen.findByText("ALFA TEKS")).toBeTruthy();
    expect(screen.queryByText("Müşterisiz (genel stok)")).toBeNull();
  });
});
