// BEKÇİ — K14 "Fiyat geçmişi": kapalıyken istek yok · açınca en yeni önce satırlar (fabrika saati, kaldırma, kim) ·
// "Daha fazla" cursor'u SUNUCUYA yollar · istasyon ve cari doğru uca gider.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KursunGramPriceHistory } from "./KursunGramPriceHistory";
import { formatFactory } from "@/lib/factory-time";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const item = (id: string, price: string | null, at: string, who: string | null) => ({
  id, validFrom: at, price, currency: price === null ? null : "TRY", createdById: who ? "u1" : null, createdByName: who,
});
const mount = (owner: { kind: "station" | "cari"; id: string }) =>
  render(<QueryClientProvider client={new QueryClient()}><KursunGramPriceHistory owner={owner} /></QueryClientProvider>);

describe("KursunGramPriceHistory", () => {
  beforeEach(() => get.mockReset());

  it("kapalıyken istek atılmaz; açınca satırlar en yeni önce, fabrika saatiyle", async () => {
    get.mockResolvedValueOnce({ data: { data: { items: [item("v2", "0.06", "2026-11-03T09:30:00.000Z", "Ayşe"), item("v1", "0.05", "2026-11-01T07:00:00.000Z", null)], nextCursor: null } } });
    mount({ kind: "station", id: "s1" });
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Fiyat geçmişi"));
    const rows = await screen.findAllByTestId("kursun-gram-history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(formatFactory("2026-11-03T09:30:00.000Z", "dd.MM.yyyy HH:mm"));
    expect(rows[0]!.textContent).toContain("0,06 TRY");
    expect(rows[0]!.textContent).toContain("Ayşe");
    expect(rows[1]!.textContent).toContain("Sistem (ilk kayıt)");
    expect(get.mock.calls[0]![0]).toBe("/api/station-capabilities/s1/kursun/price-history");
    expect(screen.queryByText("Daha fazla")).toBeNull();
  });

  it("cari ucu; kaldırma satırı 'Kaldırıldı'; Daha fazla cursor'u yollar", async () => {
    get
      .mockResolvedValueOnce({ data: { data: { items: [item("c2", null, "2026-11-02T10:00:00.000Z", "Ali")], nextCursor: "CUR1" } } })
      .mockResolvedValueOnce({ data: { data: { items: [item("c1", "0.04", "2026-11-01T10:00:00.000Z", "Ali")], nextCursor: null } } });
    mount({ kind: "cari", id: "k1" });
    fireEvent.click(screen.getByText("Fiyat geçmişi"));
    expect((await screen.findAllByTestId("kursun-gram-history-row"))[0]!.textContent).toContain("Kaldırıldı");
    expect(get.mock.calls[0]![0]).toBe("/api/finance/cari/k1/kursun-gram-history");
    fireEvent.click(screen.getByText("Daha fazla"));
    await waitFor(() => expect(screen.getAllByTestId("kursun-gram-history-row")).toHaveLength(2));
    expect(get.mock.calls[1]![1]).toEqual({ params: { limit: 20, cursor: "CUR1" } });
  });
});
