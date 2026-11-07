// Sevk Edilenler (muhasebe) — tek satır filtre çubuğu + kayıt (2026-11-07 dalga 3).
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";
import { AccountingFilterRow } from "./AccountingFilterRow";
import { ACCOUNTING_PERSIST } from "./filters";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, ready: true, setPreference: vi.fn() }),
}));

describe("Sevk Edilenler — tek satır", () => {
  it("⭐ satır: Ara · Sevk Tarihi · Müşteri · Fatura · Yön; Şube ve İade '+ Filtre'de", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AccountingFilterRow search="" onSearchChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(within(screen.getByTestId("filter-row")).getByRole("textbox")).toBeTruthy();
    const chips = within(screen.getByTestId("filter-row-scroll")).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid);
    expect(chips).toEqual(["filter-chip-date", "filter-chip-customerId", "filter-chip-invoiced", "filter-chip-destination"]);
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    const menu = within(screen.getByRole("menu"));
    for (const n of ["Şube", "İade"]) expect(menu.getByRole("menuitem", { name: n })).toBeTruthy();
  });

  it("⭐ kayıt yokken son 30 gün sevk tarihine göre (eski defaultDateRangeDays=30); allowlist tam", () => {
    expect(ACCOUNTING_PERSIST.defaultDate).toEqual({ field: "dispatchedAt", preset: "last30" });
    for (const k of ["filter[customerId]", "filter[branchId]", "filter[destination]", "filter[invoiced]", "filter[hasReturns]"]) expect(isPersistedKey(k, ACCOUNTING_PERSIST)).toBe(true);
  });
});
