// Sayfalı karne listesi (Perf-2 B1): satırlar uç uca, sayılar ilk sayfadan, sayfa durumu SON sayfadan.
import { describe, expect, it } from "vitest";
import { mergeShiftStatPages, type ShiftStatRow } from "./service";

describe("mergeShiftStatPages", () => {
  it("satırlar uç uca, sayılar ilk sayfadan", () => {
    const p = (ids: string[], next: string | null) => ({ success: true as const, data: ids.map((machineId) => ({ machineId }) as unknown as ShiftStatRow), meta: { total: 3, truncated: next !== null, live: 3, sealed: 0, nextCursor: next } });
    const m = mergeShiftStatPages([p(["a"], "k"), p(["b", "c"], null)])!;
    expect(m.data!.map((r) => r.machineId)).toEqual(["a", "b", "c"]);
    expect(m.meta.total).toBe(3);
    expect(m.meta.truncated).toBe(false);
  });
});
