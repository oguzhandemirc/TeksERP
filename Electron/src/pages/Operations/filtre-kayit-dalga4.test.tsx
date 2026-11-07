// Leventler · Dokuma İş Emirleri — tek satır + kayıt sözleşmesi (2026-11-07 dalga 4; e-İrsaliye bu hatta yok).
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { DefFilterRow } from "@/components/data-table/filter-row/DefFilterRow";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";
import * as warp from "./WarpBeams/WarpBeamsPage";
import * as weaving from "./WeavingOrders/WeavingOrdersPage";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, ready: true, setPreference: vi.fn() }),
}));

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowChips = () => within(screen.getByTestId("filter-row-scroll")).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid?.replace("filter-chip-", ""));

describe.each([
  ["Leventler", warp, ["status", "warpSpecId", "weavingOrderId"], ["originKind"]],
  ["Dokuma İş Emirleri", weaving, ["status", "itemId", "subcontractorId"], ["orderId"]],
] as const)("%s — tek satır + kayıt", (_name, mod, primary, more) => {
  it("⭐ satır: Ara + birincil kutular; gerisi '+ Filtre'de", () => {
    wrap(<DefFilterRow filters={mod.FILTERS} primaryKeys={mod.PRIMARY} search="" onSearchChange={vi.fn()} />);
    expect(within(screen.getByTestId("filter-row")).getByRole("textbox")).toBeTruthy();
    expect(rowChips()).toEqual([...primary]);
    const menuKeys = mod.FILTERS.filter((f: FilterDef) => f.kind !== "dateRange" && !mod.PRIMARY.includes(f.key)).map((f) => (f as { key: string }).key);
    expect(menuKeys).toEqual([...more]);
  });

  it("⭐ kayıt allowlist'i sayfanın bütün süzgeçleri", () => {
    for (const k of [...primary, ...more]) expect(isPersistedKey(`filter[${k}]`, mod.PERSIST)).toBe(true);
    expect(isPersistedKey("filter[bilinmeyen]", mod.PERSIST)).toBe(false);
  });
});
