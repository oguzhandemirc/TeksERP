import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useContinuousScan } from "./useContinuousScan";

describe("useContinuousScan", () => {
  it("çözülen öğeyi onResolved'e verir", async () => {
    const onResolved = vi.fn();
    const resolve = vi.fn(async (code: string) => ({ id: code }));
    const { result } = renderHook(() =>
      useContinuousScan({ resolve, onResolved, alreadyInList: () => false }),
    );
    act(() => result.current.push("CV-260615-001"));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onResolved).toHaveBeenCalledWith({ id: "CV-260615-001" }, "CV-260615-001");
  });

  it("aynı kodun rearm penceresinde ikinci ateşini yutar", async () => {
    const resolve = vi.fn(async (code: string) => ({ id: code }));
    const { result } = renderHook(() =>
      useContinuousScan({ resolve, onResolved: vi.fn(), alreadyInList: () => false, rearmMs: 5000 }),
    );
    act(() => result.current.push("CV-260615-001"));
    act(() => result.current.push("CV-260615-001"));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
  });

  it("zaten listede olan kodu çözmez", async () => {
    const resolve = vi.fn(async () => ({ id: "x" }));
    const { result } = renderHook(() =>
      useContinuousScan({ resolve, onResolved: vi.fn(), alreadyInList: () => true }),
    );
    act(() => result.current.push("CV-260615-002"));
    // mikro-görev kuyruğu boşalsın
    await act(async () => {});
    expect(resolve).not.toHaveBeenCalled();
  });

  it("eşleşme yok (null) → lastError yazar", async () => {
    const resolve = vi.fn(async () => null);
    const { result } = renderHook(() =>
      useContinuousScan({ resolve, onResolved: vi.fn(), alreadyInList: () => false }),
    );
    act(() => result.current.push("CV-260615-003"));
    await waitFor(() => expect(result.current.lastError).toMatch(/Eşleşme yok/));
  });
});
