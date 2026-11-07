// Kumaş Stoğu tek satır filtre çubuğu + sekme başına kayıt sözleşmesi (2026-11-07 dalga 2).
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";
import { buildRollFilterDefs, KARTELA_MARKED_PARAM } from "./roll-filter-defs";
import { RollsFilterRow, rollPersistConfig, INCLUDE_FIRE_PARAM } from "./RollsFilterRow";
import type { RollStatusTabKey } from "./service";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, ready: true, setPreference: vi.fn() }),
}));

function Url() {
  return <output data-testid="url">{decodeURIComponent(useLocation().search)}</output>;
}

function setup(tab: RollStatusTabKey, initial = "/") {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initial]}>
        <RollsFilterRow filters={buildRollFilterDefs(tab)} leading={<input aria-label="Okut" />} />
        <Url />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { url: () => screen.getByTestId("url").textContent ?? "" };
}

const rowChips = () => within(screen.getByTestId("filter-row-scroll")).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid?.replace("filter-chip-", ""));

describe("Kumaş Stoğu — tek satır", () => {
  it("⭐ okutma alanı satırın başında; arama kutusu ayrıca çizilmez", () => {
    setup("RAW_STOCK");
    const row = screen.getByTestId("filter-row");
    expect(within(row).getByLabelText("Okut")).toBeTruthy();
    expect(within(row).queryByRole("textbox", { name: "Ara" })).toBeNull();
  });

  it.each([
    ["RAW_STOCK", ["date", "itemId", "colorId"]],
    ["FINISHED_STOCK", ["date", "itemId", "colorId", "shipmentScope"]],
    ["SUBCONTRACTOR", ["date", "itemId", "colorId", "subcontractorId", "subcontractorCategoryId"]],
    ["PRODUCTION", ["date", "itemId", "colorId", "currentStationId"]],
  ] as const)("⭐ %s satırı: %j; gerisi '+ Filtre'de", (tab, chips) => {
    setup(tab);
    expect(rowChips()).toEqual(chips);
  });

  it("⭐ 'Fire dahil' '+ Filtre'de; seçilince URL'ye yazar, Temizle onu da siler (arama kalır)", () => {
    const t = setup("RAW_STOCK", "/?search=x");
    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    const menu = within(screen.getByRole("menu"));
    for (const n of ["Özellik", "Giriş Kaynağı", "Ekleyen", "Fire dahil"]) expect(menu.getByRole("menuitem", { name: n })).toBeTruthy();
    act(() => { fireEvent.click(menu.getByRole("menuitem", { name: "Fire dahil" })); });
    expect(t.url()).toBe(`?search=x&${INCLUDE_FIRE_PARAM}=true`);
    expect(screen.getByTestId("filter-chip-fire").dataset.active).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Temizle" }));
    expect(t.url()).toBe("?search=x");
  });
});

describe("Kumaş Stoğu — sekme başına kayıt allowlist'i", () => {
  it("⭐ Kartelalık yalnız Bitmiş Depo'nun kaydında; Fire her sekmede", () => {
    expect(isPersistedKey(KARTELA_MARKED_PARAM, rollPersistConfig("FINISHED_STOCK"))).toBe(true);
    expect(isPersistedKey(KARTELA_MARKED_PARAM, rollPersistConfig("RAW_STOCK"))).toBe(false);
    for (const tab of ["RAW_STOCK", "FINISHED_STOCK", "SUBCONTRACTOR"] as const) expect(isPersistedKey(INCLUDE_FIRE_PARAM, rollPersistConfig(tab))).toBe(true);
  });

  it("⭐ kat / depo anahtarları katalog ve bayrak yüklenmeden de kayıtta (açılışta düşmesin)", () => {
    const cfg = rollPersistConfig("RAW_STOCK");
    for (const k of ["filter[foldType]", "filter[warehouseId]", "filter[widthMin]", "filter[qtyMax]"]) expect(isPersistedKey(k, cfg)).toBe(true);
  });

  it("sekmeye özgü anahtar başka sekmenin kaydına girmez", () => {
    expect(isPersistedKey("filter[subcontractorId]", rollPersistConfig("RAW_STOCK"))).toBe(false);
    expect(isPersistedKey("filter[subcontractorId]", rollPersistConfig("SUBCONTRACTOR"))).toBe(true);
    expect(isPersistedKey("filter[entrySource]", rollPersistConfig("SEMI_FINISHED"))).toBe(false);
  });
});
