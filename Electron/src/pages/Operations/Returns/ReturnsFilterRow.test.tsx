// İade Takibi — tek satır filtre çubuğu + kayıt allowlist'i (2026-11-07 dalga 3).
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";
import { CANCELLED_PARAM, RETURN_PERSIST, ReturnsFilterRow } from "./ReturnsFilterRow";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, ready: true, setPreference: vi.fn() }),
}));

function Url() {
  return <output data-testid="url">{decodeURIComponent(useLocation().search)}</output>;
}

function setup(initial = "/") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initial]}>
        <ReturnsFilterRow leading={<input aria-label="Okut" />} />
        <Url />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return () => screen.getByTestId("url").textContent ?? "";
}

describe("İade Takibi — tek satır", () => {
  it("⭐ okutma alanı başta; Durum · Tarih · Müşteri · Neden; ayrı arama kutusu yok, '+ Filtre' yalnız dar ekranda", () => {
    setup();
    const row = screen.getByTestId("filter-row");
    expect(within(row).getByLabelText("Okut")).toBeTruthy();
    expect(within(row).queryByRole("textbox", { name: "Ara" })).toBeNull();
    const chips = within(screen.getByTestId("filter-row-scroll")).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid);
    expect(chips).toEqual(["filter-chip-cancelled", "filter-chip-date", "filter-chip-customerId", "filter-chip-reasonId"]);
    expect(screen.getByRole("button", { name: "Filtre ekle" }).className).toContain("lg:hidden");
  });

  it("⭐ Durum varsayılanı 'Geçerli' (param yok); 'İptal edilen' URL'ye yazar, Temizle siler (arama kalır)", () => {
    const url = setup("/?search=x");
    expect(screen.getByRole("button", { name: /Durum: Geçerli/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Durum: Geçerli/ }));
    act(() => { fireEvent.click(screen.getByRole("option", { name: /İptal edilen/ })); });
    expect(url()).toBe(`?search=x&${CANCELLED_PARAM}=cancelled`);
    expect(screen.getByTestId("filter-chip-cancelled").dataset.active).toBe("true");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Temizle" })); });
    expect(url()).toBe("?search=x");
  });

  it("kayıt allowlist'i: Durum + Müşteri + Neden", () => {
    for (const k of [CANCELLED_PARAM, "filter[customerId]", "filter[reasonId]"]) expect(isPersistedKey(k, RETURN_PERSIST)).toBe(true);
    expect(isPersistedKey("filter[itemId]", RETURN_PERSIST)).toBe(false);
  });
});
