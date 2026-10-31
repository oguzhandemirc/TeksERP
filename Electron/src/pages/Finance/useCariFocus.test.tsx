// D4-KUC3a — bildirim derin bağlantısı `/finance/cari?focus=<hesapId>`: hesap sunucudan `filter[id]` ile çekilir,
// kartı açılır, param temizlenir; bulunamazsa kart açılmaz.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const listCari = vi.fn();
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), listCari: (...a: unknown[]) => listCari(...a) }));

const { useCariFocus } = await import("./useCariFocus");

const wrapper = (url: string) =>
  function W({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

beforeEach(() => listCari.mockReset());

describe("useCariFocus", () => {
  it("?focus=<id> → hesap filter[id] ile çekilir, kart açılır, param temizlenir", async () => {
    const row = { id: "acc-1", code: "C1", name: "Örnek" };
    listCari.mockResolvedValue({ data: [row], pagination: { total: 1, totalPages: 1 } });
    const open = vi.fn();
    const { result } = renderHook(() => { useCariFocus(open); return useLocation(); }, { wrapper: wrapper("/finance/cari?focus=acc-1") });
    await waitFor(() => expect(open).toHaveBeenCalledWith(row));
    expect(listCari.mock.calls[0]![0]).toMatchObject({ filters: { id: "acc-1" } });
    await waitFor(() => expect(result.current.search).toBe(""));
  });

  it("odak yoksa istek atılmaz", () => {
    const open = vi.fn();
    renderHook(() => useCariFocus(open), { wrapper: wrapper("/finance/cari") });
    expect(listCari).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("hesap dönmezse (silinmiş / yetkisiz) kart açılmaz, param yine temizlenir", async () => {
    listCari.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 0 } });
    const open = vi.fn();
    const { result } = renderHook(() => { useCariFocus(open); return useLocation(); }, { wrapper: wrapper("/finance/cari?focus=yok") });
    await waitFor(() => expect(result.current.search).toBe(""));
    expect(open).not.toHaveBeenCalled();
  });

  it("CariPage odağı kart (ekstre) açıcısına bağlar", () => {
    const src = readFileSync(resolve(__dirname, "CariPage.tsx"), "utf8");
    expect(src).toContain("useCariFocus(setStatementFor)");
  });
});
