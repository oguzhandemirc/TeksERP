import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTruncationWarning } from "./useTruncationWarning";

const warn = vi.fn();
vi.mock("sonner", () => ({ toast: { warning: (...a: unknown[]) => warn(...a) } }));

describe("kesme uyarısı", () => {
  beforeEach(() => warn.mockReset());

  it("liste tam gelince SUSAR", () => {
    renderHook(() => useTruncationWarning({ total: 120, pageSize: 200 }, "Kumaş"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("liste kırpıldıysa uyarır ve SAYILARI söyler", () => {
    renderHook(() => useTruncationWarning({ total: 640, pageSize: 200 }, "Kumaş"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("Kumaş");
    // ⚠️ Soyut "liste eksik" yetmez: operatör kaçının eksik olduğunu görmeli.
    expect(String((warn.mock.calls[0]?.[1] as { description: string }).description)).toContain("200/640");
  });

  it("tam sınırda (total === pageSize) uyarmaz — kırpma YOK", () => {
    renderHook(() => useTruncationWarning({ total: 200, pageSize: 200 }, "Kumaş"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("yeniden render'da TEKRAR uyarmaz (toast yağmuru yok)", () => {
    const { rerender } = renderHook(
      (p: { total: number; pageSize: number }) => useTruncationWarning(p, "Kumaş"),
      { initialProps: { total: 640, pageSize: 200 } },
    );
    rerender({ total: 640, pageSize: 200 });
    rerender({ total: 640, pageSize: 200 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("veri henüz yokken / eksik alanla patlamaz", () => {
    renderHook(() => useTruncationWarning(undefined, "Kumaş"));
    renderHook(() => useTruncationWarning({}, "Kumaş"));
    expect(warn).not.toHaveBeenCalled();
  });
});
