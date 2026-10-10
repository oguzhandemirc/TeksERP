// Veri kapısının zamanlayıcıları: durum ilerler, unmount iki aralığı da temizler.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLoomFloorLive } from "./useLoomFloorLive";

const START = Date.UTC(2026, 9, 9, 8, 30);

describe("useLoomFloorLive — mock zamanlayıcı", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saat ve simülasyon adımı ilerler", () => {
    const { result } = renderHook(() => useLoomFloorLive({ seed: 7 }));
    const first = result.current.floor;
    expect(result.current.sampleData).toBe(true);
    expect(result.current.now).toBe(START);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current.now).toBe(START + 4_000);
    expect(result.current.floor).not.toBe(first);
    expect(result.current.floor.updatedAt).toBe(START + 4_000);
  });

  it("unmount sonrası zamanlayıcı kalmaz", () => {
    const { unmount } = renderHook(() => useLoomFloorLive());
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("vardiya bitince salon yeni vardiyayla yeniden kurulur", () => {
    const { result } = renderHook(() => useLoomFloorLive({ seed: 7, stepMs: 60_000, clockMs: 60_000 }));
    const shiftName = result.current.floor.shift.name;
    act(() => {
      vi.advanceTimersByTime(result.current.floor.shift.endsAt - START + 60_000);
    });
    expect(result.current.floor.shift.name).not.toBe(shiftName);
  });
});
