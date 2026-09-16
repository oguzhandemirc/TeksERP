// BEKÇİ — geçici bayrak: fire → açık, süre sonunda söner; yeniden fire süreyi uzatır; unmount temizler.
// Negatif sonda: `setOn(false)` düşürülünce "söner" ❌; `clearTimeout` düşürülünce "uzatır" ❌.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransientFlag } from "./useTransientFlag";

afterEach(() => vi.useRealTimers());

describe("useTransientFlag", () => {
  it("⭐ başta kapalı; fire → açık; 3 s sonra kendiliğinden kapanır", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTransientFlag(3000));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(2999); });
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current[0]).toBe(false);
  });

  it("⭐ yeniden fire süreyi UZATIR (ilk zamanlayıcı iptal)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTransientFlag(3000));
    act(() => result.current[1]());
    act(() => { vi.advanceTimersByTime(2000); result.current[1](); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current[0]).toBe(false);
  });

  it("unmount zamanlayıcıyı temizler (uyarı yok, setState yok)", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useTransientFlag(3000));
    act(() => result.current[1]());
    unmount();
    expect(clear).toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
  });
});
