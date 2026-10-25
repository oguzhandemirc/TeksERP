// Önizleme durulması: açılışta ilk gövde beklemeden gider; sonra 400 ms içinde değişen gövde TEK istek doğurur; aynı içerikli yeni nesne yeni istek ya da
// sonsuz yeniden-render döngüsü doğurmaz.
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const previewCost = vi.fn();
vi.mock("../Items/service", () => ({ previewCost: (b: unknown) => previewCost(b) }));
import { PREVIEW_DEBOUNCE_MS, useCostPreview } from "./useCostPreview";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCostPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    previewCost.mockReset().mockResolvedValue({ sonuc: null, eksikler: [], uyarilar: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("ilk gövde hemen; sonraki değişiklikler durulma süresi içinde TEK istek, son gövdeyle", async () => {
    const { rerender } = renderHook(({ b }) => useCostPreview(b), { wrapper: wrapper(), initialProps: { b: { itemId: "a" } } });
    await act(async () => {});
    expect(previewCost).toHaveBeenCalledTimes(1);
    previewCost.mockClear();
    for (const id of ["b", "c", "d"]) {
      await act(async () => { vi.advanceTimersByTime(100); });
      rerender({ b: { itemId: id } });
    }
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1); });
    expect(previewCost).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(previewCost).toHaveBeenCalledTimes(1);
    expect(previewCost).toHaveBeenCalledWith({ itemId: "d" });
    // Aynı içerikli YENİ nesne: ikinci istek yok.
    rerender({ b: { itemId: "d" } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 3); });
    expect(previewCost).toHaveBeenCalledTimes(1);
  });

  it("gövde null → istek yok", async () => {
    renderHook(() => useCostPreview(null), { wrapper: wrapper() });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 2); });
    expect(previewCost).not.toHaveBeenCalled();
  });
});
