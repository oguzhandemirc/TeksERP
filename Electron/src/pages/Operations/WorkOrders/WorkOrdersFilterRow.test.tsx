// İş Emirleri tek satır filtre çubuğu + kayıt sözleşmesi (2026-11-07 dalga 1).
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  { kind: "multi-select", key: "status", label: "Durum", options: [{ value: "PLANNED", label: "Planlandı" }] },
  { kind: "select", key: "fasonda", label: "Fasonda", options: [{ value: "1", label: "Yalnız fasondakiler" }] },
  { kind: "select", key: "fasonFirma", label: "Hangi fasonda", options: [{ value: "st-boya", label: "Boyahane" }] },
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
  it("⭐ satırda Tarih · Durum · Müşteri · Kumaş; seçili durum kutunun içinde yazar; Fasonda/Tip '+ Filtre'de", async () => {
    setup("/?filter[status]=PLANNED");
    const row = screen.getByTestId("filter-row");
    expect(row.className).toBe(FILTER_ROW_CLASS);
    const scroll = screen.getByTestId("filter-row-scroll");
    expect(within(scroll).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid)).toEqual(["filter-chip-date", "filter-chip-status", "filter-chip-customerId", "filter-chip-targetItemId"]);
    const chip = within(row).getByTestId("filter-chip-status");
    expect(chip.dataset.active).toBe("true");
    expect(within(chip).getByRole("button", { name: /Durum: Planlandı/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    const menu = within(screen.getByRole("menu"));
    for (const n of ["Fasonda", "Hangi fasonda", "Tip", "Tamamlananlar dahil", "İptaller dahil"]) expect(menu.getByRole("menuitem", { name: n })).toBeTruthy();
  });

  it("⭐ Temizle: Durum + fason yeri + tarih + Tamamlananlar dahil TEK yazımla gider, arama kalır", () => {
    const t = setup("/?search=x&filter[status]=PLANNED&filter[fasonFirma]=st-boya&dateField=createdAt&dateFrom=2026-10-01T00:00:00.000Z", true);
    fireEvent.click(screen.getByRole("button", { name: "Temizle" }));
    expect(t.url()).toBe("?search=x");
    expect(t.setShowCompleted).toHaveBeenCalledWith(false);
  });

  it("kayıt allowlist'i: Durum + Fasonda + fason yeri/aşama + tanımlar; varsayılan son 30 gün açılış", () => {
    const cfg = workOrderPersistConfig(FILTERS);
    for (const k of ["filter[status]", "filter[fasonda]", "filter[fasonFirma]", "filter[asama]", "filter[type]", "filter[customerId]"]) expect(isPersistedKey(k, cfg)).toBe(true);
    expect(isPersistedKey("filter[eski]", cfg)).toBe(false);
    expect(cfg.defaultDate).toEqual({ field: "createdAt", preset: "last30" });
  });
});
