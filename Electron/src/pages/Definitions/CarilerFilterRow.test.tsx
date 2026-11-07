// Cariler — Yön × Fason süzgeci URL'de ve kullanıcı başına kayıtlı (2026-11-07 dalga 3).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AppPreferences } from "@/types/preferences";
import { CarilerFilterRow, cariFilters, useCariFilters } from "./CarilerFilterRow";

let prefs: AppPreferences = {};
const setPreference = vi.fn();
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs, ready: true, setPreference }),
}));

let seen: { direction: string; subcontractor: string; ready: boolean } | null = null;
let readies: boolean[] = [];
function Probe() {
  const { filters, ready } = useCariFilters();
  seen = { ...filters, ready };
  readies.push(ready);
  return <output data-testid="url">{decodeURIComponent(useLocation().search)}</output>;
}

function setup(initial = "/") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initial]}>
        <CarilerFilterRow search="" onSearchChange={vi.fn()} trailing={<span>3 kart</span>} />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return () => screen.getByTestId("url").textContent ?? "";
}

beforeEach(() => {
  prefs = {};
  seen = null;
  readies = [];
  setPreference.mockClear();
});

describe("Cariler — tek satır + kayıt", () => {
  it("⭐ satır: Ara · Yön · Fason; '+ Filtre' yalnız dar ekranda (boş kutuları taşır)", () => {
    setup();
    const chips = within(screen.getByTestId("filter-row-scroll")).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid);
    expect(chips).toEqual(["filter-chip-direction", "filter-chip-subcontractor"]);
    expect(screen.getByRole("button", { name: "Filtre ekle" }).className).toContain("lg:hidden");
  });

  it("⭐ kayıtlı Yön/Fason açılışta geri gelir; geri yükleme bitene dek ready=false (sorgu beklesin), bitince true", async () => {
    prefs = { tableFilters: { cariler: { query: "filter[direction]=CUSTOMER&filter[subcontractor]=YES", savedAt: "2026-11-07T00:00:00.000Z" } } };
    const url = setup();
    await waitFor(() => expect(seen?.ready).toBe(true));
    expect(readies[0]).toBe(false);
    expect(url()).toBe("?filter[direction]=CUSTOMER&filter[subcontractor]=YES");
    expect(seen).toMatchObject({ direction: "CUSTOMER", subcontractor: "YES" });
  });

  it("⭐ derin bağlantı kaydı ezer (URL'deki süzgeç kalır, kayıt uygulanmaz)", async () => {
    prefs = { tableFilters: { cariler: { query: "filter[direction]=CUSTOMER", savedAt: "2026-11-07T00:00:00.000Z" } } };
    const url = setup("/?filter[subcontractor]=NO");
    await waitFor(() => expect(seen?.ready).toBe(true));
    expect(url()).toBe("?filter[subcontractor]=NO");
    expect(seen).toMatchObject({ direction: "ALL", subcontractor: "NO" });
  });

  it("Temizle iki süzgeci de kaldırır", async () => {
    const url = setup("/?filter[direction]=SUPPLIER&filter[subcontractor]=YES");
    await waitFor(() => expect(seen?.ready).toBe(true));
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Temizle" })); });
    expect(url()).toBe("");
    expect(seen).toMatchObject({ direction: "ALL", subcontractor: "ALL" });
  });

  it("tanınmayan değer 'Tümü' (bayat URL boş liste vermez)", () => {
    expect(cariFilters("XYZ", null)).toEqual({ direction: "ALL", subcontractor: "ALL" });
    expect(cariFilters("BOTH", "NO")).toEqual({ direction: "BOTH", subcontractor: "NO" });
  });
});
