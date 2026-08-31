// =============================================================================
// BEKÇİ — FilterBar lookup: "seçenek yok" ile "seçenekler GELMEDİ" ayrı şeylerdir
// =============================================================================
// ⭐ BU, 2026-08-12'DE SAHADA YAŞANAN VAKANIN SINIFIDIR. O gün lookup servisinin
//    yolu yanlıştı (`/rolls/...` yerine `/api/rolls/...`), istek 404 aldı ve
//    şerit bunu "Sonuç yok." diye bastı. O gün SEMPTOM (URL) düzeltildi, SEBEP
//    (hata = boş) düzeltilmedi — yani aynı olay ikinci kez yaşansa ekran yine
//    hiçbir şey söylemeyecekti. Kullanıcı filtreyi "boş" sanıp süzmeden çalışır.
// ⭐ ÜÇ VARYANT DA KAPSANIR (tekil / çoklu / bağımlı): biri atlanırsa aynı yalan
//    o varyantta yaşamaya devam eder — hata sınıfı "bir yerde" kapanmaz.
// ⭐ "Tümü" seçeneği hata durumunda da DURUR: seçenek listesi okunamasa bile
//    filtreyi TEMİZLEMEK yapılabilmelidir.
// =============================================================================
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { FilterBar, type FilterDef } from "./FilterBar";

// ⚠️ YEREL SARMALAYICI (ortak `renderWithProviders` DEĞİL): bağımlı lookup
// varyantı ÜST FİLTRENİN URL'de dolu olmasını şart koşar — parent boşken pasif
// bir düğme çizer ve popover hiç açılmaz. Ortak yardımcı `initialEntries`
// almadığı için o varyant test edilemezdi (ve sessizce kapsam dışı kalırdı).
function renderBar(ui: ReactElement, url = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

const getAll = vi.fn();
const fetchOptions = vi.fn();

const service = { getAll: (...a: unknown[]) => getAll(...a) } as never;

const SINGLE: FilterDef = {
  kind: "lookup",
  key: "customerId",
  label: "Müşteri",
  service,
  queryKey: "customers",
};
const MULTI: FilterDef = {
  kind: "multi-lookup",
  key: "itemId",
  label: "Kumaş",
  service,
  queryKey: "items",
};
const DEPENDENT: FilterDef = {
  kind: "dependent-lookup",
  key: "branchId",
  label: "Şube",
  dependsOn: "customerId",
  queryKey: "branches",
  fetchOptions: (id: string) => fetchOptions(id),
};

async function openFirstFilter(name: RegExp) {
  await userEvent.click(await screen.findByRole("button", { name }));
}

describe("FilterBar lookup — hata dalı", () => {
  beforeEach(() => {
    getAll.mockReset();
    fetchOptions.mockReset();
  });

  it("TEKİL: seçenek sorgusu düşerse “Sonuç yok.” BASILMAZ, sebep + Tekrar dene basılır", async () => {
    getAll.mockRejectedValue(new Error("404"));
    renderBar(<FilterBar filters={[SINGLE]} />);

    await openFirstFilter(/Müşteri/);

    expect(await screen.findByText("Seçenekler yüklenemedi")).toBeTruthy();
    // Asıl kural: yanlış cümle EKRANDA OLMAMALI.
    expect(screen.queryByText("Sonuç yok.")).toBeNull();
    expect(screen.getByText(/anlamına GELMEZ/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tekrar dene/ })).toBeTruthy();
    // Filtreyi temizleme yolu hata durumunda da açık kalır.
    expect(screen.getByText(/Tümü \(Müşteri\)/)).toBeTruthy();
  });

  it("ÇOKLU: aynı ayrım çoklu seçim varyantında da geçerli", async () => {
    getAll.mockRejectedValue(new Error("500"));
    renderBar(<FilterBar filters={[MULTI]} />);

    await openFirstFilter(/Kumaş/);

    expect(await screen.findByText("Seçenekler yüklenemedi")).toBeTruthy();
    expect(screen.queryByText("Sonuç yok.")).toBeNull();
  });

  it("BAĞIMLI: üst filtre seçiliyken alt liste düşerse de aynı ayrım geçerli", async () => {
    fetchOptions.mockRejectedValue(new Error("500"));
    // Üst filtre URL'de dolu olmalı; yoksa bağımlı seçici pasif düğme çizer.
    renderBar(<FilterBar filters={[DEPENDENT]} />, "/?filter[customerId]=c1");

    await openFirstFilter(/Şube/);

    expect(await screen.findByText("Seçenekler yüklenemedi")).toBeTruthy();
    expect(screen.queryByText("Sonuç yok.")).toBeNull();
  });

  // ⚠️ ÇOKLU varyantta ölçülür: TEKİL varyant her zaman bir "Tümü (…)" satırı
  // çizer, cmdk eşleşen satır sayısını 0 görmez ve `CommandEmpty` HİÇ render
  // olmaz — o varyantta kontrol vakumen yeşil kalırdı.
  it("BAŞARILI + BOŞ yanıtta davranış bayt-bayt eski: “Sonuç yok.” basılır", async () => {
    getAll.mockResolvedValue({ data: [], pagination: { total: 0 } });
    renderBar(<FilterBar filters={[MULTI]} />);

    await openFirstFilter(/Kumaş/);

    expect(await screen.findByText("Sonuç yok.")).toBeTruthy();
    expect(screen.queryByText("Seçenekler yüklenemedi")).toBeNull();
  });

  it("BAŞARILI + DOLU yanıtta ne hata bloğu ne boş metni", async () => {
    getAll.mockResolvedValue({
      data: [{ id: "c1", code: "M01", name: "Ak Tekstil" }],
      pagination: { total: 1 },
    });
    renderBar(<FilterBar filters={[SINGLE]} />);

    await openFirstFilter(/Müşteri/);

    expect(await screen.findByText("Ak Tekstil")).toBeTruthy();
    expect(screen.queryByText("Seçenekler yüklenemedi")).toBeNull();
  });
});
