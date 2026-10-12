// Sayfalı dokuma listesi (Perf-2 B1): toplamlar İLK sayfadan (tam küme), satırlar uç uca, sayfa durumu SON sayfadan.
import { describe, expect, it } from "vitest";
import { mergeEfficiencyPages, mergeShiftStatPages, type EfficiencyReport, type ShiftStatRow } from "./service";

const meta = (truncated: boolean, nextCursor: string | null) => ({ ufuk: "2026-09-14", ufukOncesiSatir: 0, total: 3, truncated, live: 3, sealed: 0, nextCursor });
const eff = (ids: string[], truncated: boolean, nextCursor: string | null) => ({
  success: true as const,
  data: { satirlar: ids.map((machineId) => ({ machineId })), toplam: { rowCount: 3 }, kaynakKirilimi: {}, meta: meta(truncated, nextCursor) } as unknown as EfficiencyReport,
});

describe("mergeEfficiencyPages", () => {
  it("satırlar uç uca, toplam ilk sayfadan, son sayfa bitti ⇒ truncated false", () => {
    const m = mergeEfficiencyPages([eff(["a", "b"], true, "c1"), eff(["c"], false, null)])!;
    expect(m.data!.satirlar.map((r) => r.machineId)).toEqual(["a", "b", "c"]);
    expect(m.data!.toplam.rowCount).toBe(3);
    expect(m.data!.meta.truncated).toBe(false);
    expect(m.data!.meta.nextCursor).toBeNull();
  });
  it("tek sayfa ve boş giriş", () => {
    expect(mergeEfficiencyPages(undefined)).toBeUndefined();
    expect(mergeEfficiencyPages([eff(["a"], true, "x")])!.data!.meta.nextCursor).toBe("x");
  });
});

describe("mergeShiftStatPages", () => {
  it("satırlar uç uca, sayılar ilk sayfadan", () => {
    const p = (ids: string[], next: string | null) => ({ success: true as const, data: ids.map((machineId) => ({ machineId }) as unknown as ShiftStatRow), meta: { total: 3, truncated: next !== null, live: 3, sealed: 0, nextCursor: next } });
    const m = mergeShiftStatPages([p(["a"], "k"), p(["b", "c"], null)])!;
    expect(m.data!.map((r) => r.machineId)).toEqual(["a", "b", "c"]);
    expect(m.meta.total).toBe(3);
    expect(m.meta.truncated).toBe(false);
  });
});
