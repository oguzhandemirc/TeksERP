import { describe, expect, it, vi } from "vitest";
import type { PdfApi } from "@shared/ipc-contract";
import * as progress from "@shared/pdf-progress";
import type { PdfBatchProgress } from "@shared/pdf-progress";

const t = vi.hoisted(() => ({ loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: t }));

const { withPdfBatchProgress } = await import("./pdf-batch-progress");

describe("withPdfBatchProgress", () => {
  it("başlangıçta 0/N, her olayda n/N aynı bildirimde; bitince abonelik kapanır ve bildirim kalkar", async () => {
    let emit: ((p: PdfBatchProgress) => void) | null = null;
    const off = vi.fn();
    const api = { onBatchProgress: (cb: (p: PdfBatchProgress) => void) => ((emit = cb), off) } as unknown as PdfApi;
    const res = await withPdfBatchProgress(api, 2, async () => {
      emit?.({ done: 1, total: 2 });
      emit?.({ done: 2, total: 2 });
      return "tamam";
    });
    expect(res).toBe("tamam");
    const texts = t.loading.mock.calls.map((c) => c[0]);
    expect(texts).toEqual(["PDF'ler hazırlanıyor… 0/2", "PDF'ler hazırlanıyor… 1/2", "PDF'ler hazırlanıyor… 2/2"]);
    const ids = new Set(t.loading.mock.calls.map((c) => (c[1] as { id: string }).id));
    expect(ids.size).toBe(1);
    expect(off).toHaveBeenCalledOnce();
    expect(t.dismiss).toHaveBeenCalledWith([...ids][0]);
  });

  it("iş hata verse de bildirim kalkar; olay köprüsü olmayan (eski) preload'da da çalışır", async () => {
    t.dismiss.mockClear();
    await expect(withPdfBatchProgress({} as PdfApi, 3, async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(t.dismiss).toHaveBeenCalledOnce();
  });

  it("ilerleme yükü yeniden doğrulanır: yalnız 0 ≤ done ≤ total, total > 0 tam sayılar geçer", () => {
    expect(progress.parsePdfBatchProgress({ done: 2, total: 5, x: "y" })).toEqual({ done: 2, total: 5 });
    for (const bad of [null, "2/5", { done: 6, total: 5 }, { done: -1, total: 5 }, { done: 1, total: 0 }, { done: 1.5, total: 5 }, { done: "1", total: 5 }]) {
      expect(progress.parsePdfBatchProgress(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(progress.pdfBatchProgressText({ done: 3, total: 50 })).toBe("PDF'ler hazırlanıyor… 3/50");
  });
});
