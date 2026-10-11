// Salon seçiminin saf çekirdeği: tık / Ctrl / Shift aralığı, toplu seçim, tazelemede budama, lasso
// geometrisi ve ok tuşu komşusu (tasarım TEZGAH-SALONU-SECIM-IS-VERME §A).
import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, LASSO_MIN_PX, applyClick, applyMany, boxOf, intersects, isDrag, lassoPick, neighborOf, pruneSelection, type Box, type Selection } from "./selection";

const ORDER = ["a", "b", "c", "d", "e"];
const PLAIN = { toggle: false, range: false };
const CTRL = { toggle: true, range: false };
const SHIFT = { toggle: false, range: true };
const CTRL_SHIFT = { toggle: true, range: true };
const ids = (s: Selection) => [...s.ids].sort();
const sel = (xs: string[], anchor: string | null = xs[0] ?? null): Selection => ({ ids: new Set(xs), anchor });

describe("applyClick", () => {
  it("düz tık önceki seçimi düşürür, tıklananı tek seçili + çapa yapar", () => {
    const s = applyClick(sel(["a", "b"]), "c", PLAIN, ORDER);
    expect(ids(s)).toEqual(["c"]);
    expect(s.anchor).toBe("c");
  });

  it("Ctrl/Cmd+tık ekler, ikinci kez çıkarır (detay açmaz — çağıran karar verir)", () => {
    const added = applyClick(sel(["a"]), "c", CTRL, ORDER);
    expect(ids(added)).toEqual(["a", "c"]);
    const removed = applyClick(added, "a", CTRL, ORDER);
    expect(ids(removed)).toEqual(["c"]);
  });

  it("Shift+tık çapadan tıklanana kadar GÖRÜNEN sırayla aralık seçer (iki yönde)", () => {
    expect(ids(applyClick(sel(["b"], "b"), "d", SHIFT, ORDER))).toEqual(["b", "c", "d"]);
    expect(ids(applyClick(sel(["d"], "d"), "a", SHIFT, ORDER))).toEqual(["a", "b", "c", "d"]);
  });

  it("Shift aralığı mevcut seçimi yeniler; Ctrl+Shift üstüne ekler; çapa değişmez", () => {
    const base = sel(["e", "b"], "b");
    const plain = applyClick(base, "c", SHIFT, ORDER);
    expect(ids(plain)).toEqual(["b", "c"]);
    expect(plain.anchor).toBe("b");
    expect(ids(applyClick(base, "c", CTRL_SHIFT, ORDER))).toEqual(["b", "c", "e"]);
  });

  it("çapa süzgeç dışındaysa Shift aralık kurmaz, düz tık gibi davranır", () => {
    expect(ids(applyClick(sel(["x"], "x"), "c", SHIFT, ORDER))).toEqual(["c"]);
  });
});

describe("applyMany / pruneSelection", () => {
  it("toplu seçim (lasso, hol, Ctrl+A) yeniler; add=true ekler", () => {
    expect(ids(applyMany(sel(["a"]), ["c", "d"], false))).toEqual(["c", "d"]);
    expect(ids(applyMany(sel(["a"]), ["c", "d"], true))).toEqual(["a", "c", "d"]);
    expect(applyMany(EMPTY_SELECTION, ["c"], false).anchor).toBe("c");
  });

  it("tazelemede listeden düşen tezgah seçimden çıkar ve sayılır; kalanlar kimlikle korunur", () => {
    const r = pruneSelection(sel(["a", "b", "c"], "b"), new Set(["a", "c", "z"]));
    expect(ids(r.sel)).toEqual(["a", "c"]);
    expect(r.dropped).toBe(1);
    expect(r.sel.anchor).toBeNull();
  });

  it("hiçbiri düşmediyse aynı nesne döner (gereksiz çizim yok)", () => {
    const s = sel(["a"]);
    expect(pruneSelection(s, new Set(["a", "b"]))).toEqual({ sel: s, dropped: 0 });
  });
});

describe("lasso geometrisi", () => {
  const card = (id: string, left: number, top: number): { id: string; box: Box } => ({ id, box: { left, top, right: left + 100, bottom: top + 80 } });
  const cards = [card("a", 0, 0), card("b", 110, 0), card("c", 220, 0), card("d", 0, 90), card("e", 110, 90)];

  it("kutu iki köşeden, sürükleme yönünden bağımsız", () => {
    expect(boxOf(50, 60, 10, 20)).toEqual({ left: 10, top: 20, right: 50, bottom: 60 });
  });

  it("dikdörtgene DEĞEN kart seçilir (tamamen içinde olması gerekmez)", () => {
    expect(lassoPick(boxOf(95, 75, 115, 95), cards).sort()).toEqual(["a", "b", "d", "e"]);
    expect(intersects({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 11, top: 0, right: 20, bottom: 10 })).toBe(false);
  });

  it(`${LASSO_MIN_PX} px'ten kısa sürükleme tıktır`, () => {
    expect(isDrag(0, 0, LASSO_MIN_PX - 1, LASSO_MIN_PX - 1)).toBe(false);
    expect(isDrag(0, 0, LASSO_MIN_PX, 0)).toBe(true);
    expect(isDrag(0, 0, 0, -LASSO_MIN_PX)).toBe(true);
  });

  it("ok tuşu komşusu geometriden: sağ/sol aynı sırada, aşağı/yukarı sonraki sırada yatayda en yakın", () => {
    const b = cards[1]!.box;
    expect(neighborOf(b, "ArrowRight", cards)).toBe("c");
    expect(neighborOf(b, "ArrowLeft", cards)).toBe("a");
    expect(neighborOf(b, "ArrowDown", cards)).toBe("e");
    expect(neighborOf(cards[4]!.box, "ArrowUp", cards)).toBe("b");
    expect(neighborOf(cards[2]!.box, "ArrowRight", cards)).toBeNull();
    expect(neighborOf(cards[2]!.box, "ArrowDown", cards)).toBe("e");
  });
});
