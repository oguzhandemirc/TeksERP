// Siparişler tek satır filtre çubuğu — süzme SUNUCUDA, çubuk yalnız URL yazar.
// Ölçülen: Görünüm (filter[nerede]) + faceted sayılar, Termin penceresi seçenekleri → tarih
// parametreleri, ✕/Temizle, fason kutuları ("+ Filtre"), üretim kapalı rejimi.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

// Modal seçicinin kendisi ayrı bekçili; burada yalnız URL sözleşmesi ölçülür.
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
    <div>
      <span data-testid="firma-value">{value ?? ""}</span>
      <button type="button" onClick={() => onChange("11111111-1111-4111-8111-111111111111")}>firma-sec</button>
    </div>
  ),
}));

// Lookup katalogları ağa çıkmasın (seçili değerin etiketi için istenirler).
const { emptyList } = vi.hoisted(() => ({
  emptyList: { getAll: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 200, total: 0, totalPages: 0 } }) },
}));
vi.mock("@/pages/Customers/service", () => ({ customerService: emptyList }));
vi.mock("@/pages/Items/service", () => ({ itemService: emptyList }));
vi.mock("@/pages/Colors/service", () => ({ colorService: emptyList }));
vi.mock("@/pages/Operations/Shipments/service", () => ({ branchLookupService: emptyList }));

const getStats = vi.fn();
vi.mock("./service", () => ({ orderService: { getStats: (...a: unknown[]) => getStats(...a) } }));

import { OrdersFilterRow } from "./OrdersFilterRow";
import { ORDER_FILTERS } from "./orders-filter-defs";
import { resolveOrderFilters } from "./orders-regime";

function Probe() {
  return <output data-testid="url">{decodeURIComponent(useLocation().search)}</output>;
}

function setup(initial = "/?cursor=abc&page=3", productionEnabled = true, showCancelled = false, cancelledUrlKey?: string) {
  const setShowCancelled = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initial]}>
        <OrdersFilterRow
          filters={resolveOrderFilters(ORDER_FILTERS, productionEnabled)}
          productionEnabled={productionEnabled}
          search=""
          onSearchChange={() => {}}
          placeholder="Ara"
          showCancelled={showCancelled}
          setShowCancelled={setShowCancelled}
          forceFilters={{ hideCancelled: "true" }}
          cancelledUrlKey={cancelledUrlKey}
        />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { url: () => screen.getByTestId("url").textContent ?? "", setShowCancelled };
}

const openView = () => fireEvent.click(within(screen.getByTestId("filter-chip-nerede")).getByRole("button", { name: /Görünüm:/ }));
const addFilter = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name }));
};

beforeEach(() => {
  getStats.mockReset();
  getStats.mockImplementation((p: { filters: Record<string, string> }) =>
    Promise.resolve({ data: { totalCount: p.filters.nerede === "FASONDA" ? 4 : p.filters.nerede ? 2 : 10 } }),
  );
});

describe("Görünüm — hızlı sekmeler tek açılırda", () => {
  it("seçim → filter[nerede]; cursor/page sıfırlanır; kutu adı seçimi söyler", () => {
    const { url } = setup();
    openView();
    fireEvent.click(screen.getByRole("option", { name: /Fasonda/ }));
    expect(url()).toBe("?filter[nerede]=FASONDA");
    expect(screen.getByRole("button", { name: /Görünüm: Fasonda/ })).toBeInTheDocument();
    expect(screen.getByTestId("filter-chip-nerede")).toHaveAttribute("data-active", "true");
  });

  it("Tümü anahtarı SİLER, öteki süzgeçler kalır; ✕ de aynı", () => {
    const { url } = setup("/?filter[nerede]=KISMEN&filter[status]=APPROVED");
    openView();
    fireEvent.click(screen.getByRole("option", { name: /Tümü/ }));
    expect(url()).toBe("?filter[status]=APPROVED");
    cleanup();
    const second = setup("/?filter[nerede]=GECIKEN&filter[status]=APPROVED");
    fireEvent.click(screen.getByRole("button", { name: "Görünüm filtresini kaldır" }));
    expect(second.url()).toBe("?filter[status]=APPROVED");
  });

  it("sayılar FACETED: yalnız liste açılınca istenir; taban aynı, yalnız nerede değişir", async () => {
    setup("/?filter[nerede]=KISMEN&filter[customerId]=c1&search=ab");
    expect(getStats).not.toHaveBeenCalled();
    openView();
    await waitFor(() => expect(within(screen.getByRole("option", { name: /Fasonda/ })).getByText("4")).toBeInTheDocument());
    const calls = getStats.mock.calls.map((c) => c[0] as { filters: Record<string, string>; search?: string });
    expect(calls).toHaveLength(6);
    for (const c of calls) {
      expect(c.filters.customerId).toBe("c1");
      expect(c.filters.hideCancelled).toBe("true");
      expect(c.search).toBe("ab");
    }
    // "Tümü" kendi anahtarını taşımaz (KISMEN sızmaz).
    expect(calls.filter((c) => !("nerede" in c.filters))).toHaveLength(1);
    expect(within(screen.getByRole("option", { name: /Tümü/ })).getByText("10")).toBeInTheDocument();
  });

  it("üretim kapalıyken Fasonda / Sevke hazır seçenekleri ve fason kutuları yok", () => {
    setup("/", false);
    openView();
    expect(screen.queryByRole("option", { name: /Fasonda/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Sevke hazır/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Gecikenler/ })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.queryByRole("menuitem", { name: "Fason firma" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "İş Emri" })).toBeNull();
  });
});

describe("Termin — kutu PENCERE açar, seçenekler doğru tarih parametrelerini yazar", () => {
  // Yerel gün sınırları bağımsız kurulur (FilterBar tarih kutusunun kuralı).
  const now = new Date();
  const dayIso = (offset: number, end = false) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0).toISOString();
  const openTermin = () => fireEvent.click(screen.getByRole("button", { name: /Termin: Tümü/ }));

  it("pencere seçenekleri: Tümü · Bugün · Son 7 gün · Son 30 gün · Termini geçmiş · Tarih aralığı", () => {
    setup("/");
    openTermin();
    const dlg = within(screen.getByRole("dialog"));
    const names = dlg.getAllByRole("radio").map((r) => r.textContent);
    expect(names).toEqual(["Termin", "Sipariş tarihi", "Tümü", "Bugün", "Son 7 gün", "Son 30 gün", "Termini geçmiş", "Tarih aralığı"]);
  });

  it("Son 7 gün tek tıkla uygulanır → dateField=deadline + yerel gün sınırları; kutu yazısı değişir", () => {
    const { url } = setup("/?filter[status]=APPROVED");
    openTermin();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Son 7 gün" }));
    const sp = new URLSearchParams(url());
    expect(sp.get("dateField")).toBe("deadline");
    expect(sp.get("dateFrom")).toBe(dayIso(-6));
    expect(sp.get("dateTo")).toBe(dayIso(0, true));
    expect(sp.get("filter[status]")).toBe("APPROVED");
    expect(screen.getByRole("button", { name: /Termin: Son 7 gün/ })).toBeInTheDocument();
  });

  it("Termini geçmiş → dateTo = dünün sonu, alt sınır yok", () => {
    const { url } = setup("/");
    openTermin();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Termini geçmiş" }));
    const sp = new URLSearchParams(url());
    expect(sp.has("dateFrom")).toBe(false);
    expect(sp.get("dateTo")).toBe(dayIso(-1, true));
  });

  it("Sipariş tarihi seçilince 'Termini geçmiş' düşer; Bugün createdAt'e yazılır ve kutu adı alanı söyler", () => {
    const { url } = setup("/");
    openTermin();
    const dlg = within(screen.getByRole("dialog"));
    fireEvent.click(dlg.getByRole("radio", { name: "Sipariş tarihi" }));
    expect(dlg.queryByRole("radio", { name: "Termini geçmiş" })).toBeNull();
    fireEvent.click(dlg.getByRole("radio", { name: "Bugün" }));
    expect(new URLSearchParams(url()).get("dateField")).toBe("createdAt");
    expect(screen.getByRole("button", { name: /Sipariş tarihi: Bugün/ })).toBeInTheDocument();
  });

  it("Tarih aralığı 'Uygula' ister; boş aralıkta Uygula kapalı", () => {
    setup("/");
    openTermin();
    const dlg = within(screen.getByRole("dialog"));
    fireEvent.click(dlg.getByRole("radio", { name: "Tarih aralığı" }));
    expect(dlg.getByRole("button", { name: "Uygula" })).toBeDisabled();
  });

  it("Termin ✕ üç tarih anahtarını siler", () => {
    const { url } = setup("/?dateField=deadline&dateTo=2026-01-01T00:00:00.000Z&filter[status]=APPROVED");
    fireEvent.click(screen.getByRole("button", { name: "Termin filtresini kaldır" }));
    expect(url()).toBe("?filter[status]=APPROVED");
  });
});

describe("+ Filtre ve Temizle", () => {
  it("fason firma kutusu eklenir, seçim filter[fasonFirma] yazar", () => {
    const { url } = setup("/");
    addFilter("Fason firma");
    fireEvent.click(screen.getByText("firma-sec"));
    expect(url()).toBe("?filter[fasonFirma]=11111111-1111-4111-8111-111111111111");
  });

  it("'Fasonda X günden uzun' yazma durunca URL'e işlenir; geçersiz girdi süzgeci kaldırır", () => {
    vi.useFakeTimers();
    try {
      const { url } = setup("/");
      addFilter("Fasonda gün");
      const input = screen.getByLabelText("Fasonda kaç günden uzun");
      fireEvent.change(input, { target: { value: "3" } });
      expect(url()).toBe("");
      act(() => void vi.advanceTimersByTime(500));
      expect(url()).toBe("?filter[fasonGun]=3");
      fireEvent.change(input, { target: { value: "-1" } });
      act(() => void vi.advanceTimersByTime(500));
      expect(url()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("müşteri ✕ bağlı şubeyi de kaldırır (bayat şube kalmaz)", () => {
    const { url } = setup("/?filter[customerId]=c1&filter[branchId]=b1&filter[status]=APPROVED");
    fireEvent.click(screen.getByRole("button", { name: "Müşteri filtresini kaldır" }));
    expect(url()).toBe("?filter[status]=APPROVED");
  });

  it("Temizle: Görünüm + Termin + kutular + fason + İptaller dahil hepsi gider", () => {
    const { url, setShowCancelled } = setup(
      "/?filter[nerede]=FASONDA&dateField=deadline&dateTo=2026-01-01T00:00:00.000Z&filter[customerId]=c1&filter[fasonGun]=3",
      true,
      true,
    );
    expect(screen.getByTestId("filter-chip-iptal")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: /Temizle/ }));
    expect(url()).toBe("");
    expect(setShowCancelled).toHaveBeenCalledWith(false);
  });

  it("'İptaller dahil' + Filtre'den doğrudan etkinleşir", () => {
    const { setShowCancelled } = setup("/");
    addFilter("İptaller dahil");
    expect(setShowCancelled).toHaveBeenCalledWith(true);
  });

  it("⭐ 'İptaller dahil' URL'deyse (filtre kaydına girer) Temizle onu da TEK URL yazımıyla siler", () => {
    const { url, setShowCancelled } = setup("/?filter[customerId]=c1&showCancelled=1&search=x", true, true, "showCancelled");
    expect(screen.getByTestId("filter-chip-iptal")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: /Temizle/ }));
    expect(url()).toBe("?search=x");
    expect(setShowCancelled).not.toHaveBeenCalled();
  });
});
