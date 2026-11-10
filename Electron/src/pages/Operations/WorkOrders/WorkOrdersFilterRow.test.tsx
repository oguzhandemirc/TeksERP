// İş Emirleri tek satır filtre çubuğu + kayıt sözleşmesi (2026-11-07 dalga 1).
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

const { emptyList } = vi.hoisted(() => ({
  emptyList: { getAll: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 200, total: 0, totalPages: 0 } }) },
}));
vi.mock("@/pages/Customers/service", () => ({ customerService: emptyList }));
vi.mock("@/pages/Items/service", () => ({ itemService: emptyList }));
vi.mock("@/pages/Colors/service", () => ({ colorService: emptyList }));
vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: vi.fn(async () => ({ success: true, data: [{ id: "st-boya", name: "Boyahane", type: "EXTERNAL", kind: "SUBCONTRACTOR", isActive: true }], pagination: { page: 1, pageSize: 500, total: 1, totalPages: 1 } })),
}));

import { WorkOrdersFilterRow, workOrderPersistConfig } from "./WorkOrdersFilterRow";
import { FILTER_ROW_CLASS } from "@/components/data-table/filter-row/FilterRow";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";
import type { FilterDef } from "@/components/data-table/FilterBar";

const FILTERS: FilterDef[] = [
  { kind: "select", key: "type", label: "Tip", options: [{ value: "STOCK_PRODUCTION", label: "Stok" }] },
  { kind: "multi-lookup", key: "targetItemId", label: "Kumaş", service: emptyList as never, queryKey: "items" },
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: emptyList as never, queryKey: "customers" },
  { kind: "dateRange", label: "Tarih", defaultField: "createdAt", fieldOptions: [{ value: "createdAt", label: "Açılış" }] },
];

function Probe() {
  return <output data-testid="url">{decodeURIComponent(useLocation().search)}</output>;
}

function setup(initial: string, showCompleted = false) {
  const setShowCompleted = vi.fn();
  const setShowCancelled = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initial]}>
        <WorkOrdersFilterRow filters={FILTERS} search="" onSearchChange={() => {}} placeholder="Ara" showCompleted={showCompleted} setShowCompleted={setShowCompleted} showCancelled={false} setShowCancelled={setShowCancelled} />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { url: () => screen.getByTestId("url").textContent ?? "", setShowCompleted, setShowCancelled };
}

describe("İş Emirleri — tek satır", () => {
  it("⭐ Durum kutusu satırda; seçili durum kutunun içinde yazar, ayrı seçim satırı çizilmez", async () => {
    setup("/?filter[status]=PLANNED");
    const row = screen.getByTestId("filter-row");
    expect(row.className).toBe(FILTER_ROW_CLASS);
    const chip = within(row).getByTestId("filter-chip-durum");
    expect(chip.dataset.active).toBe("true");
    expect(within(chip).getByRole("button", { name: /Durum: Planlandı/ })).toBeTruthy();
    expect(screen.queryByTestId("status-location-chips")).toBeNull();
  });

  it("⭐ Temizle: Durum/konum anahtarları + tarih + Tamamlananlar dahil TEK yazımla gider, arama kalır", () => {
    const t = setup("/?search=x&filter[status]=PLANNED&filter[konumIstasyon]=st-boya&dateField=createdAt&dateFrom=2026-10-01T00:00:00.000Z", true);
    fireEvent.click(screen.getByRole("button", { name: "Temizle" }));
    expect(t.url()).toBe("?search=x");
    expect(t.setShowCompleted).toHaveBeenCalledWith(false);
  });

  it("⭐ 'Beyandan uzun' '+ Filtre'de; seçilince URL'ye filter[meterCheck]=LONGER yazar, Temizle siler", () => {
    const t = setup("/?search=x");
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    act(() => { fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "Beyandan uzun" })); });
    expect(t.url()).toBe("?search=x&filter[meterCheck]=LONGER");
    expect(screen.getByTestId("filter-chip-metreUzun").dataset.active).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Temizle" }));
    expect(t.url()).toBe("?search=x");
  });

  it("kayıt allowlist'i: Durum/konum + fason yeri + tanımlar; varsayılan son 30 gün açılış", () => {
    const cfg = workOrderPersistConfig(FILTERS);
    for (const k of ["filter[meterCheck]", "filter[status]", "filter[konumIstasyon]", "filter[konumSinifi]", "filter[fasonFirma]", "filter[type]", "filter[customerId]"]) expect(isPersistedKey(k, cfg)).toBe(true);
    expect(isPersistedKey("filter[eski]", cfg)).toBe(false);
    expect(cfg.defaultDate).toEqual({ field: "createdAt", preset: "last30" });
  });
});
