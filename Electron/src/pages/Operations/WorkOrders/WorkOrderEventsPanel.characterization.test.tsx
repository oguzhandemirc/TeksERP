// İş emri Hareketler — KARAKTERİZASYON (kartela defteri K3 öncesi yazıldı). Tablo ve Excel
// gövdesi ortak zaman çizelgesine taşınırken iş emri ekranının görünen davranışı değişmesin:
// satır sırası, başlıklar, hücre metinleri, grup çipleri, altbilgi, boş/hata durumu, Excel
// başlıkları ve satırları (tüm sayfalar). Test genelleştirmeden önce ve sonra AYNEN yeşil.
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

import { WorkOrderEventsPanel } from "./WorkOrderEventsPanel";

const satir = (n: number, over: Record<string, unknown> = {}) => ({
  id: `woe:${n}`, at: `2026-09-2${n}T10:0${n}:00.000Z`, group: "DURUM", title: `Olay ${n}`,
  detail: `ayrıntı ${n}`, reason: n === 1 ? "sebep bir" : null, actor: n % 2 ? "Ayşe" : null,
  channel: n % 2 ? "Tablet" : "Panel", trigger: n === 2 ? "Elle kapatma" : null, derived: n === 3, ...over,
});
const sayfa = (rows: unknown[], nextCursor: string | null) => ({
  data: {
    data: rows,
    pagination: { nextCursor, hasMore: nextCursor !== null },
    groups: [
      { key: "DURUM", label: "Durum", count: 3 },
      { key: "PLAN", label: "Plan", count: 0 },
      { key: "FASON", label: "Fason", count: 1 },
    ],
  },
});
const wo = { id: "wo-1", workOrderNumber: "IE-2609-001" };

describe("İş emri Hareketler — karakterizasyon", () => {
  beforeEach(() => {
    get.mockReset();
    excel.mockReset().mockResolvedValue(true);
  });

  it("satırlar sunucu sırasıyla (en yeniden eskiye), başlıklar ve hücre metinleri sabit", async () => {
    get.mockResolvedValueOnce(sayfa([satir(3), satir(2), satir(1)], null));
    renderWithProviders(<WorkOrderEventsPanel workOrder={wo} />);
    const tablo = await screen.findByTestId("is-emri-hareketleri");
    expect(within(tablo).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Zaman", "Olay", "Ayrıntı", "Kim · nereden"]);
    const satirlar = within(tablo).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(satirlar.map((r) => r[1])).toEqual(["Olay 3 (sonradan türetildi)", "Olay 2", "Olay 1"]);
    expect(satirlar[2]![2]).toBe("ayrıntı 1\nSebep: sebep bir");
    expect(satirlar[1]![3]).toBe("—\nPanel · Elle kapatma");
    expect(satirlar[0]![3]).toBe("Ayşe\nTablet");
    expect(get).toHaveBeenCalledWith("/api/work-orders/wo-1/events", { params: { limit: 50 } });
  });

  it("grup çipleri: Tümü + sayısı sıfırdan büyük gruplar; altbilgi listenin bittiğini söyler", async () => {
    get.mockResolvedValueOnce(sayfa([satir(1)], null));
    renderWithProviders(<WorkOrderEventsPanel workOrder={wo} />);
    await screen.findByTestId("is-emri-hareketleri");
    const cipler = within(screen.getByRole("group", { name: "Olay grubu" })).getAllByRole("button").map((b) => b.textContent);
    expect(cipler).toEqual(["Tümü", "Durum 3", "Fason 1"]);
    expect(screen.getByText("1 hareket gösteriliyor (en yeniden eskiye). Bu süzgeçte başka hareket yok.")).toBeTruthy();
  });

  it("boş durum ve hata durumu metinleri", async () => {
    get.mockResolvedValueOnce(sayfa([], null));
    const { unmount } = renderWithProviders(<WorkOrderEventsPanel workOrder={wo} />);
    expect(await screen.findByText("Bu iş emrinde henüz kayıtlı hareket yok.")).toBeTruthy();
    unmount();
    get.mockRejectedValueOnce(new Error("ağ"));
    renderWithProviders(<WorkOrderEventsPanel workOrder={wo} />);
    expect(await screen.findByText("Hareketler yüklenemedi.")).toBeTruthy();
  });

  it("Excel: tüm sayfalar çekilir, başlıklar ve satırlar ekranla aynı, dosya adı iş emri numarasından", async () => {
    get
      .mockResolvedValueOnce(sayfa([satir(3), satir(2)], "c1"))
      .mockResolvedValueOnce(sayfa([satir(3), satir(2)], "c1"))
      .mockResolvedValueOnce(sayfa([satir(1)], null));
    renderWithProviders(<WorkOrderEventsPanel workOrder={wo} />);
    await screen.findByTestId("is-emri-hareketleri");
    expect(screen.getByText(/Liste KIRPILDI/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(excel).toHaveBeenCalledTimes(1));
    const [cols, rows, ad] = excel.mock.calls[0] as [ExportColumn<{ id: string }>[], { id: string }[], string];
    expect(cols.map((c) => c.label)).toEqual(["Zaman", "Olay", "Ayrıntı", "Kim · nereden"]);
    expect(rows.map((r) => r.id)).toEqual(["woe:3", "woe:2", "woe:1"]);
    expect(rows.map((r) => String(cols[1]!.value(r)))).toEqual(["Olay 3 (sonradan türetildi)", "Olay 2", "Olay 1"]);
    expect(ad).toBe("IE-2609-001-hareketler");
    expect(get).toHaveBeenLastCalledWith("/api/work-orders/wo-1/events", { params: { limit: 200, cursor: "c1" } });
  });
});
