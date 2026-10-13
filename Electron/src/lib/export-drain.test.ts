// BEKÇİ — "Tüm listeyi indir" tavana çarpınca SÖYLER (Perf-2 B4)
//   NEGATİF SONDA: tavan dalı `truncated: false` dönerse §2 ❌
import { describe, expect, it, vi } from "vitest";
import { drainCursor, truncatedExportNote, type DrainPage } from "./export-drain";

/** n satırlık sunucu; sayfa boyu 2. */
function sunucu(n: number) {
  const calls: Array<string | null> = [];
  const fetchPage = async (cursor: string | null): Promise<DrainPage<number>> => {
    calls.push(cursor);
    const start = cursor === null ? 0 : Number(cursor);
    const data = Array.from({ length: Math.max(0, Math.min(2, n - start)) }, (_, i) => start + i);
    const next = start + 2 < n ? String(start + 2) : null;
    return { data, pagination: { nextCursor: next, ...(cursor === null ? { totalEstimate: n } : {}) } };
  };
  return { fetchPage, calls };
}

describe("drainCursor", () => {
  it("§1 imleç sonuna kadar: tüm satırlar sırayla, truncated=false, ilerleme toplamı ilk sayfadan", async () => {
    const s = sunucu(5);
    const progress = vi.fn();
    const r = await drainCursor(s.fetchPage, progress, 10);
    expect(r).toEqual({ rows: [0, 1, 2, 3, 4], truncated: false });
    expect(progress).toHaveBeenLastCalledWith(5, 5);
    expect(s.calls).toEqual([null, "2", "4"]);
  });
  it("§2 ⭐ tavanda durur ve truncated=true (sessiz eksik dosya yok)", async () => {
    const r = await drainCursor(sunucu(10).fetchPage, undefined, 3);
    expect(r.rows).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.truncated).toBe(true);
  });
  it("§3 tavan = tam son sayfa → kesik DEĞİL", async () => {
    const r = await drainCursor(sunucu(6).fetchPage, undefined, 3);
    expect(r).toEqual({ rows: [0, 1, 2, 3, 4, 5], truncated: false });
  });
  it("§4 uyarı metni sayıyı ve 'TAMAMI DEĞİL'i taşır", () => {
    expect(truncatedExportNote(500000)).toContain("500.000");
    expect(truncatedExportNote(1)).toContain("TAMAMI DEĞİL");
  });
});
