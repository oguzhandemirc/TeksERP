import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { RELOAD_DELAY_MS, registerSoftRefresh, reloadDropsSession, reloadTitle, useShellReload } from "@/store/shell-reload";
import { tokenStore } from "@/lib/secure-token";
import { useSpinWhile } from "@/hooks/useSpinWhile";

describe("sayfa yenileme animasyonu", () => {
  const reload = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    reload.mockReset();
    vi.stubGlobal("location", { ...window.location, reload });
    useShellReload.setState({ busy: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tıklanınca meşgul olur, gecikmeden sonra TEK kez yeniden yükler", () => {
    useShellReload.getState().reload();
    expect(useShellReload.getState().busy).toBe(true);
    useShellReload.getState().reload(); // çift tıklama
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RELOAD_DELAY_MS + 1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // B18/14: tarayıcıda bellekteki token tam yenilemede ölür → düğme sayfayı değil verileri yeniler.
  it("⭐ tarayıcı + bellekteki token → sayfa YENİLENMEZ, veri yenileyici çağrılır; token yoksa tam yenileme", async () => {
    const soft = vi.fn(() => Promise.resolve());
    registerSoftRefresh(soft);
    await tokenStore.set("t");
    expect(reloadDropsSession()).toBe(true);
    expect(reloadTitle()).toMatch(/Verileri yeniden yükle/);
    useShellReload.getState().reload();
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS + 1);
    expect(soft).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(useShellReload.getState().busy).toBe(false);
    await tokenStore.clear();
    expect(reloadDropsSession()).toBe(false);
    expect(reloadTitle()).toMatch(/oturum açık kalır/);
    useShellReload.getState().reload();
    vi.advanceTimersByTime(RELOAD_DELAY_MS + 1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("useSpinWhile etkin bittikten sonra en az süre döner", () => {
    const { result, rerender } = renderHook(({ a }) => useSpinWhile(a, 600), { initialProps: { a: true } });
    expect(result.current).toBe(true);
    rerender({ a: false });
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(601));
    expect(result.current).toBe(false);
  });
});
