// Sevkiyatlar tek satır filtre çubuğu + kayıt sözleşmesi (2026-11-07 dalga 1).
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

const { emptyList } = vi.hoisted(() => ({
  emptyList: { getAll: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 200, total: 0, totalPages: 0 } }) },
}));
vi.mock("@/pages/Customers/service", () => ({ customerService: emptyList }));

import { ShipmentsFilterRow, shipmentPersistConfig } from "./ShipmentsFilterRow";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";
import type { FilterDef } from "@/components/data-table/FilterBar";

const FILTERS: FilterDef[] = [
  { kind: "multi-select", key: "status", label: "Durum", options: [{ value: "PLANNED", label: "Planlandı" }] },
  { kind: "select", key: "invoiced", label: "Fatura", options: [{ value: "false", label: "Kesilmedi" }] },
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: emptyList as never, queryKey: "customers" },
  { kind: "dependent-lookup", key: "branchId", label: "Şube", dependsOn: "customerId", queryKey: "b", fetchOptions: () => Promise.resolve([]), getLabel: () => "" } as FilterDef,
  { kind: "select", key: "hasReturns", label: "İade", options: [{ value: "true", label: "Yalnız iade" }] },
  { kind: "dateRange", label: "Tarih", defaultField: "createdAt", fieldOptions: [{ value: "createdAt", label: "Oluşturma" }] },
];

function Probe() {
  return <output data-testid="url">{decodeURIComponent(useLocation().search)}</output>;
}

function setup(initial: string) {
  const setShowCancelled = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initial]}>
        <ShipmentsFilterRow filters={FILTERS} search="" onSearchChange={() => {}} placeholder="Ara" setShowCancelled={setShowCancelled} />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { url: () => screen.getByTestId("url").textContent ?? "", setShowCancelled };
}

describe("Sevkiyatlar — tek satır", () => {
  it("⭐ satırda Tarih · Durum · Müşteri · Fatura; Şube/İade + İptaller dahil '+ Filtre'de", () => {
    setup("/");
    const scroll = screen.getByTestId("filter-row-scroll");
    expect(within(scroll).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid)).toEqual(["filter-chip-date", "filter-chip-status", "filter-chip-customerId", "filter-chip-invoiced"]);
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    const menu = within(screen.getByRole("menu"));
    for (const n of ["Şube", "İade", "İptaller dahil"]) expect(menu.getByRole("menuitem", { name: n })).toBeTruthy();
  });

  it("⭐ İptaller dahil URL'de: kutu etkin, Temizle onu ve Müşteri→Şube'yi TEK yazımla siler", () => {
    const t = setup("/?showCancelled=1&filter[customerId]=c1&filter[branchId]=b1&search=x");
    expect(screen.getByTestId("filter-chip-iptal").dataset.active).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Temizle" }));
    expect(t.url()).toBe("?search=x");
  });

  it("kayıt allowlist'i: tanımlar + showCancelled; varsayılan son 30 gün", () => {
    const cfg = shipmentPersistConfig(FILTERS);
    for (const k of ["filter[status]", "filter[branchId]", "showCancelled"]) expect(isPersistedKey(k, cfg)).toBe(true);
    expect(isPersistedKey("filter[eski]", cfg)).toBe(false);
    expect(cfg.defaultDate).toEqual({ field: "createdAt", preset: "last30" });
  });
});
