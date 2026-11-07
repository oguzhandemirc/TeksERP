// Kartela Takibi — iç sekme başına filtre kaydı + tek satır çubuk (2026-11-07 dalga 2).
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, ready: true, setPreference: vi.fn() }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("./service", () => ({
  kartelaService: {
    listDispatchesCursor: () => Promise.resolve({ success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } }),
    listReceiptsCursor: () => Promise.resolve({ success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } }),
  },
}));

import { DispatchesTab, DISPATCH_PERSIST, RECEIPT_PERSIST } from "./KartelaTabs";

describe("Kartela — Sevkler tek satır", () => {
  it("⭐ satır: okutma alanı + Tarih · Durum · Firma; ayrı arama kutusu yok", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DispatchesTab onSelect={vi.fn()} onScanSwatch={vi.fn()} swatchLookupPending={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = screen.getByTestId("filter-row");
    expect(within(row).getByPlaceholderText("Ara ya da barkod okut...")).toBeTruthy();
    expect(within(row).queryByRole("textbox", { name: "Ara" })).toBeNull();
    const chips = within(screen.getByTestId("filter-row-scroll")).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid);
    expect(chips).toEqual(["filter-chip-date", "filter-chip-status", "filter-chip-subcontractorId"]);
  });

  it("kayıt allowlist'i: Durum + Firma (sekme başına ayrı anahtar)", () => {
    for (const cfg of [DISPATCH_PERSIST, RECEIPT_PERSIST]) {
      expect(isPersistedKey("filter[status]", cfg)).toBe(true);
      expect(isPersistedKey("filter[subcontractorId]", cfg)).toBe(true);
      expect(isPersistedKey("filter[itemId]", cfg)).toBe(false);
    }
  });
});
