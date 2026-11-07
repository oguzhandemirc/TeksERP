// Çuvallar + Top Arşivi — tek satır + kayıt sözleşmesi (2026-11-07 panel filtre dalga 5).
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { DefFilterRow } from "@/components/data-table/filter-row/DefFilterRow";
import { isDeepLink, isPersistedKey, restoredSubset } from "@/components/data-table/filter-row/filter-persist";
import { buildRollFilterDefs, DATE_FILTER } from "@/pages/Operations/Rolls/roll-filter-defs";
import { ARCHIVE_PERSIST, ARCHIVE_PRIMARY } from "@/pages/System/RollArchivePage";
import { SACK_PERSIST, isTargetedOpen, sackRowSplit } from "./sack-filter-defs";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, ready: true, setPreference: vi.fn() }),
}));

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const rowChips = () => within(screen.getByTestId("filter-row-scroll")).getAllByTestId(/^filter-chip-/).map((c) => c.dataset.testid?.replace("filter-chip-", ""));

describe("Çuvallar — tek satır", () => {
  it("⭐ satır: Kapsam · Müşteri · Kumaş · Renk; tarih ve gerisi '+ Filtre'de", () => {
    const split = sackRowSplit(true, false);
    wrap(<FilterRow leading={<input aria-label="okut" />} primary={split.primary} more={split.more} />);
    expect(rowChips()).toEqual(["scope", "customerId", "itemId", "colorId"]);
    expect(split.more.map((f) => f.id)).toContain("date");
    expect(split.more.map((f) => f.id)).toContain("branchId");
  });

  it("parti çalışma alanında Müşteri kutusu çizilmez; şube kapalıyken Şube menüde yok", () => {
    const split = sackRowSplit(false, true);
    expect(split.primary.map((f) => f.id)).toEqual(["scope", "itemId", "colorId"]);
    expect(split.more.map((f) => f.id)).not.toContain("branchId");
  });
});

describe("Çuvallar — kayıt", () => {
  it("⭐ allowlist: Kapsam/Kumaş/Etiket/En/Tarih kaydedilir; Müşteri, Şube, Parti KAYDEDİLMEZ", () => {
    for (const k of ["filter[scope]", "filter[itemId]", "filter[tagId]", "filter[weighed]", "filter[hasNote]", "dateFrom", "sortBy"]) expect(isPersistedKey(k, SACK_PERSIST)).toBe(true);
    for (const k of ["filter[customerId]", "filter[branchId]", "filter[packingGroupId]"]) expect(isPersistedKey(k, SACK_PERSIST)).toBe(false);
  });

  it("⭐ giriş kapısının yazdığı cari derin bağlantı değildir → kayıt geri yüklenir, cari kayıttan gelmez", () => {
    expect(isDeepLink(new URLSearchParams("filter[customerId]=c1"), SACK_PERSIST)).toBe(false);
    expect(restoredSubset({ query: "filter[customerId]=c9&filter[scope]=ALL" }, SACK_PERSIST).toString()).toBe("filter%5Bscope%5D=ALL");
  });

  it("⭐ okutma tohumu ya da parti içi açılış hedeflidir (kayıt uygulanmaz)", () => {
    const sp = new URLSearchParams();
    expect(isTargetedOpen({ scanCode: "CV-1" }, sp)).toBe(true);
    expect(isTargetedOpen({ scanCodeDispatched: "CV-1" }, sp)).toBe(true);
    expect(isTargetedOpen(null, new URLSearchParams("filter[packingGroupId]=g1"))).toBe(true);
    expect(isTargetedOpen(null, new URLSearchParams("filter[customerId]=c1"))).toBe(false);
    expect(isTargetedOpen({ other: 1 }, sp)).toBe(false);
  });
});

describe("Top Arşivi — tek satır + kayıt", () => {
  it("⭐ satır: Ara + Tarih · Kayıt Türü · Kumaş · Renk", () => {
    const filters = [DATE_FILTER, ...buildRollFilterDefs("ARCHIVE")];
    wrap(<DefFilterRow filters={filters} primaryKeys={ARCHIVE_PRIMARY} search="" onSearchChange={vi.fn()} />);
    expect(within(screen.getByTestId("filter-row")).getByRole("textbox")).toBeTruthy();
    expect(rowChips()).toEqual(["date", "statusIn", "itemId", "colorId"]);
  });

  it("allowlist arşiv sekmesinin tanımları (Kayıt Türü dahil)", () => {
    expect(isPersistedKey("filter[statusIn]", ARCHIVE_PERSIST)).toBe(true);
    expect(isPersistedKey("filter[itemId]", ARCHIVE_PERSIST)).toBe(true);
    expect(isPersistedKey("filter[bilinmeyen]", ARCHIVE_PERSIST)).toBe(false);
  });
});
