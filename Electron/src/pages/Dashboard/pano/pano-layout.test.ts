import { describe, expect, it, vi } from "vitest";
import type { PanoBoxDef } from "./box-types";
import { applySubsetOrder, cleanLayout, defaultLayout, moveBox, packRows } from "./pano-layout";
import { groupRequests, requestBox, setBoxFetcher, type BoxRequest } from "./pano-batch";

// Pano yerleşimi ve istek toplayıcı — saf işlev bekçisi.

const def = (anahtar: string, varsayilan: boolean, boyut: PanoBoxDef["boyut"] = "orta"): PanoBoxDef => ({
  anahtar, baslik: anahtar, aciklama: "", grup: "genel", donemli: true, varsayilan, boyut,
});

describe("varsayılan ve kayıtlı düzen", () => {
  it("varsayılan = katalogdaki varsayilan:true kutular katalog sırasıyla + açık yerel kutular", () => {
    const cat = [def("uretim", true, "kpi"), def("ciro", false, "kpi"), def("egilim", true, "genis")];
    expect(defaultLayout(cat, new Set(["hizliIslemler"]))).toEqual(["uretim", "egilim", "hizliIslemler"]);
  });

  it("katalogda olmayan, tekrar eden ve string olmayan anahtar sessizce düşer", () => {
    expect(cleanLayout(["a", "eski", "a", 3, "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
    expect(cleanLayout(undefined, new Set(["a"]))).toBeNull();
    expect(cleanLayout("a", new Set(["a"]))).toBeNull();
  });
});

describe("sıralama", () => {
  it("moveBox sürüklenen kutuyu hedefin yerine koyar", () => {
    expect(moveBox(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveBox(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveBox(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });

  it("görünmeyen anahtar tam listede yerinde kalır", () => {
    expect(applySubsetOrder(["a", "gizli", "b", "c"], ["c", "a", "b"])).toEqual(["c", "gizli", "a", "b"]);
  });
});

describe("12 sütunlu paketleme", () => {
  it("her satır 12'ye tamamlanır, sıra korunur", () => {
    const rows = packRows([
      { key: "egilim", size: "genis" }, { key: "dagilim", size: "orta" },
      { key: "enCok", size: "orta" }, { key: "tezgah", size: "kucuk" }, { key: "stok", size: "orta" },
      { key: "ajanda", size: "genis" }, { key: "ajanda2", size: "genis" },
    ]);
    for (const r of rows) expect(r.reduce((a, p) => a + p.span, 0)).toBe(12);
    expect(rows.flat().map((p) => p.key)).toEqual(["egilim", "dagilim", "enCok", "tezgah", "stok", "ajanda", "ajanda2"]);
    expect(rows[0]).toEqual([{ key: "egilim", span: 8 }, { key: "dagilim", span: 4 }]);
    expect(rows.at(-1)).toEqual([{ key: "ajanda2", span: 12 }]);
  });

  it("artık temel genişlik oranında dağıtılır", () => {
    expect(packRows([{ key: "a", size: "orta" }, { key: "b", size: "orta" }])[0]).toEqual([{ key: "a", span: 6 }, { key: "b", span: 6 }]);
  });
});

describe("istek toplayıcı", () => {
  const r = (key: string, o: Partial<BoxRequest> = {}): BoxRequest => ({ key, donem: "hafta", periodic: true, ...o });

  it("dönemsiz kutu dönemli gruba katılır; ajanda parametresi ayrı grup", () => {
    const groups = groupRequests([r("uretim"), r("stok", { periodic: false }), r("ajanda", { periodic: false, gun: "2026-11-03", ay: "2026-11" })]);
    expect(groups.map((g) => g.map((x) => x.key))).toEqual([["uretim", "stok"], ["ajanda"]]);
  });

  it("aynı tikteki istekler tek çağrıda; PANO_BOX_UNKNOWN → bilinmeyen null, kalan yeniden istenir", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce({ response: { data: { details: { code: "PANO_BOX_UNKNOWN", unknown: ["yok"] } } } })
      .mockResolvedValueOnce({ kutular: { uretim: { x: 1 } } });
    setBoxFetcher(fetcher);
    try {
      const [a, b] = await Promise.all([requestBox(r("uretim")), requestBox(r("yok"))]);
      expect(a).toEqual({ x: 1 });
      expect(b).toBeNull();
      expect(fetcher.mock.calls.map((c) => c[0].kutular)).toEqual([["uretim", "yok"], ["uretim"]]);
    } finally {
      setBoxFetcher(null);
    }
  });
});
