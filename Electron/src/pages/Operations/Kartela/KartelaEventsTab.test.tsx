// Kartela Hareketleri — ekrandaki sütunlar = Excel sütunları; süzgeç sunucuya yalnız doluysa gider.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ExportColumn } from "@/lib/list-export";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
const excel = vi.fn();
vi.mock("@/lib/list-export", async (orig) => ({
  ...(await orig<typeof import("@/lib/list-export")>()),
  exportRowsToXlsx: (...a: unknown[]) => excel(...a),
}));

import { KartelaEventsTab } from "./KartelaEventsTab";
import { KARTELA_EVENT_COLUMNS, kartelaEventsQueryParams, type KartelaEventItem } from "./kartelaEvents";

const row: KartelaEventItem = {
  id: "e1", at: "2026-09-26T08:00:00.000Z", group: "CUVAL", title: "Çuvala girdi",
  detail: "Stokta → Çuvalda · Çuval CV260926-0001", reason: "müşteri isteği", actor: "Ayşe", channel: "Tablet",
  trigger: "Çuvala okutma", swatchId: "s1", card: "KRT2609260001", product: "Poplin · Beyaz",
};
const sayfa = { data: { data: [row], pagination: { nextCursor: null, hasMore: false }, groups: [
  { key: "KABUL", label: "Kabul", count: 0 }, { key: "CUVAL", label: "Çuval", count: 1 },
  { key: "SEVKIYAT", label: "Sevkiyat", count: 0 }, { key: "DUSUM", label: "Düşüm", count: 0 },
] } };

describe("Kartela Hareketleri", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue(sayfa);
    excel.mockReset().mockResolvedValue(true);
  });

  it("boş süzgeç parametre olarak GİTMEZ; dolu olan gider", () => {
    expect(kartelaEventsQueryParams({}, { limit: 50 })).toEqual({ limit: 50 });
    expect(kartelaEventsQueryParams({ search: "  CV1 ", swatchId: "s1" }, { group: "CUVAL", cursor: "c", limit: 2 }))
      .toEqual({ limit: 2, search: "CV1", swatchId: "s1", group: "CUVAL", cursor: "c" });
  });

  it("tablo başlıkları ve hücreleri sütun modelinden; Excel aynı başlık ve değerlerle", async () => {
    renderWithProviders(<KartelaEventsTab />);
    const tablo = await screen.findByTestId("kartela-hareketleri");
    expect(within(tablo).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(KARTELA_EVENT_COLUMNS.map((c) => c.label));
    const hucreler = within(tablo).getAllByRole("cell").map((c) => c.textContent);
    expect(hucreler).toEqual(KARTELA_EVENT_COLUMNS.map((c) => String(c.value(row))));
    expect(hucreler[4]).toContain("Sebep: müşteri isteği");
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(excel).toHaveBeenCalledTimes(1));
    const [cols, rows, ad] = excel.mock.calls[0] as [ExportColumn<KartelaEventItem>[], KartelaEventItem[], string];
    expect(cols.map((c) => c.label)).toEqual(KARTELA_EVENT_COLUMNS.map((c) => c.label));
    expect(cols.map((c) => String(c.value(rows[0]!)))).toEqual(hucreler);
    expect(ad).toBe("kartela-hareketleri");
  });

  it("arama gönderilince sunucuya TAM değerle gider, grup çipi sayaçla görünür", async () => {
    renderWithProviders(<KartelaEventsTab />);
    await screen.findByTestId("kartela-hareketleri");
    expect(within(screen.getByRole("group", { name: "Olay grubu" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Tümü", "Çuval 1"]);
    fireEvent.change(screen.getByLabelText("Kartela hareketlerinde ara"), { target: { value: " CV260926-0001 " } });
    fireEvent.click(screen.getByRole("button", { name: "Ara" }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/api/kartela/events", { params: { limit: 50, search: "CV260926-0001" } }));
  });
});
