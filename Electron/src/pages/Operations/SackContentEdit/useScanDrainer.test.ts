import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useScanDrainer } from "./useScanDrainer";

describe("useScanDrainer — aktif-çuval seri okutma", () => {
  it("aynı kodu işlenirken/kuyruktayken tekrar eklemez (dedup)", async () => {
    const onScan = vi.fn(async () => {});
    const { result } = renderHook(() => useScanDrainer({ onScan, rearmMs: 5 }));
    act(() => {
      result.current.push("TEKS-1");
      result.current.push("TEKS-1");
    });
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("boş/whitespace kodu yutar", async () => {
    const onScan = vi.fn(async () => {});
    const { result } = renderHook(() => useScanDrainer({ onScan, rearmMs: 5 }));
    act(() => result.current.push("   "));
    await new Promise((r) => setTimeout(r, 20));
    expect(onScan).not.toHaveBeenCalled();
  });

  it("farklı kodları SIRAYLA işler — biri bitmeden öteki başlamaz", async () => {
    const order: string[] = [];
    let resolveFirst: (() => void) | null = null;
    const onScan = vi.fn(async (code: string) => {
      order.push(code);
      if (code === "A") await new Promise<void>((res) => (resolveFirst = res));
    });
    const { result } = renderHook(() => useScanDrainer({ onScan, rearmMs: 5 }));
    act(() => {
      result.current.push("A");
      result.current.push("B");
    });
    // A işlenmeye başladı, B kuyrukta bekliyor (henüz başlamadı).
    await waitFor(() => expect(order).toEqual(["A"]));
    expect(result.current.queueLength).toBe(1);
    // A bitince B başlamalı.
    act(() => resolveFirst?.());
    await waitFor(() => expect(order).toEqual(["A", "B"]));
  });
});
