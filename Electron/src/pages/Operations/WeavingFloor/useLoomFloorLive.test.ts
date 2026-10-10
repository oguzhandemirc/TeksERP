// Gerçek veri kapısı: `GET /api/loom-floor` yoklanır, "şimdi" sunucu saatine hizalanır.
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("./service", () => ({ loomFloorService: { get: () => get() } }));

import { useLoomFloorLive } from "./useLoomFloorLive";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const EMPTY = { total: 0, monitored: 0, running: 0, stopped: 0, unmonitored: 0, overdue: 0, stoppedByClass: { UNPLANNED: 0, SETUP: 0, PLANNED: 0, NON_SCHEDULED: 0, UNCLASSIFIED: 0 }, nowPct: null, todayPct: null };

describe("useLoomFloorLive", () => {
  afterEach(() => {
    get.mockReset();
    vi.useRealTimers();
  });

  it("veri gelene dek floor null; gelince FloorState ve sunucuya hizalı saat", async () => {
    // Sunucu saati istemciden 10 dk ileride.
    const serverAsOf = Date.now() + 10 * 60_000;
    get.mockResolvedValue({ asOf: new Date(serverAsOf).toISOString(), factoryDayStart: new Date(serverAsOf).toISOString(), shift: null, graceMinutes: 0, dokumaEnabled: false, summary: EMPTY, halls: [], looms: [] });
    const { result } = renderHook(() => useLoomFloorLive({ pollMs: 60_000 }), { wrapper });
    expect(result.current.floor).toBeNull();
    expect(result.current.sampleData).toBe(false);
    await waitFor(() => expect(result.current.floor).not.toBeNull());
    expect(result.current.floor!.shift).toBeNull();
    expect(Math.abs(result.current.now - serverAsOf)).toBeLessThan(5_000);
  });

  it("ilk istek hata verirse floor null kalır ve hata döner", async () => {
    get.mockRejectedValue(new Error("403"));
    const { result } = renderHook(() => useLoomFloorLive({ pollMs: 60_000 }), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.floor).toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it("saat 1 sn'de akar; unmount aralığı temizler", () => {
    vi.useFakeTimers();
    get.mockReturnValue(new Promise(() => undefined));
    const clear = vi.spyOn(window, "clearInterval");
    const { result, unmount } = renderHook(() => useLoomFloorLive({ pollMs: 60_000 }), { wrapper });
    const first = result.current.now;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.now).toBe(first + 1_000);
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
