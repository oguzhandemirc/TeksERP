import { describe, expect, it } from "vitest";
import {
  applyTemplate, cellsOnLine, clampRect, copyRect, deleteFrames, deletePicks, flipFrames, flipPicks, historyCommitFrom, historyInit,
  historyPush, historyRedo, historyReplace, historyUndo, insertFrames, insertPicks, invertBlock, lenoAfterDeleteFrames,
  lenoAfterInsertFrames, normRect, pasteAt, repeatRect, setCells, shiftBlock, templateById, WEAVE_TEMPLATES,
} from "./lift-plan-edit";

const blank = (picks: number, frames: number) => Array.from({ length: picks }, () => new Array<number>(frames).fill(0));

describe("sürükle-boya", () => {
  it("cellsOnLine uçlar dahil, atlamasız", () => {
    expect(cellsOnLine({ r: 0, c: 0 }, { r: 0, c: 3 })).toHaveLength(4);
    const diag = cellsOnLine({ r: 0, c: 0 }, { r: 3, c: 3 });
    expect(diag).toEqual([{ r: 0, c: 0 }, { r: 1, c: 1 }, { r: 2, c: 2 }, { r: 3, c: 3 }]);
    expect(cellsOnLine({ r: 2, c: 2 }, { r: 2, c: 2 })).toEqual([{ r: 2, c: 2 }]);
  });
  it("setCells boyar; değişmeyen satır aynı dizi, hiç değişmezse aynı plan", () => {
    const p = blank(3, 3);
    const q = setCells(p, [{ r: 1, c: 0 }, { r: 1, c: 2 }, { r: 9, c: 0 }], 1);
    expect(q[1]).toEqual([1, 0, 1]);
    expect(q[0]).toBe(p[0]);
    expect(setCells(q, [{ r: 1, c: 0 }], 1)).toBe(q);
  });
});

describe("seçim · kopyala · yapıştır · tekrarla", () => {
  const p = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  it("normRect + clampRect", () => {
    expect(normRect({ r: 3, c: 1 }, { r: 0, c: 2 })).toEqual({ r0: 0, r1: 3, c0: 1, c1: 2 });
    expect(clampRect(p, { r0: 2, c0: 2, r1: 9, c1: 9 })).toEqual({ r0: 2, c0: 2, r1: 3, c1: 3 });
    expect(clampRect(p, { r0: 5, c0: 0, r1: 6, c1: 0 })).toBeNull();
  });
  it("kopyala → yapıştır; taşan kırpılır", () => {
    const clip = copyRect(p, { r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(clip).toEqual([[1, 0], [0, 1]]);
    const q = pasteAt(p, clip, { r: 2, c: 3 });
    expect(q[2]).toEqual([0, 0, 0, 1]);
    expect(q[3]).toEqual([0, 0, 0, 0]);
  });
  it("atkı yönünde tekrar: blok ızgara sonuna dek döşenir", () => {
    const q = repeatRect(p, { r0: 0, c0: 0, r1: 1, c1: 1 }, "picks");
    expect(q.map((r) => r.slice(0, 2))).toEqual([[1, 0], [0, 1], [1, 0], [0, 1]]);
    expect(q[2]![2]).toBe(0);
  });
  it("çerçeve yönünde tekrar: yalnız seçili atkılarda", () => {
    const q = repeatRect(p, { r0: 0, c0: 0, r1: 1, c1: 1 }, "frames");
    expect(q.slice(0, 2)).toEqual([[1, 0, 1, 0], [0, 1, 0, 1]]);
    expect(q[2]).toBe(p[2]);
  });
});

describe("blok dönüşümleri", () => {
  const b = [[1, 0, 0], [0, 1, 1]];
  it("ayna ve ters", () => {
    expect(flipFrames(b)).toEqual([[0, 0, 1], [1, 1, 0]]);
    expect(flipPicks(b)).toEqual([[0, 1, 1], [1, 0, 0]]);
    expect(invertBlock(b)).toEqual([[0, 1, 1], [1, 0, 0]]);
  });
  it("döngüsel kaydırma", () => {
    expect(shiftBlock(b, 0, 1)).toEqual([[0, 1, 0], [1, 0, 1]]);
    expect(shiftBlock(b, 1, 0)).toEqual([[0, 1, 1], [1, 0, 0]]);
    expect(shiftBlock(b, 0, -1)).toEqual([[0, 0, 1], [1, 1, 0]]);
  });
});

describe("hazır örgüler", () => {
  it("her şablon kare, her atkıda en az bir kalkık ve en az bir inik çerçeve", () => {
    for (const t of WEAVE_TEMPLATES) {
      expect(t.unit.every((row) => row.length === t.unit.length), t.id).toBe(true);
      expect(t.unit.every((row) => row.includes(1) && row.includes(0)), t.id).toBe(true);
      // her çerçeve raporda en az bir kez kalkar (çözgü bağlanır)
      expect(t.unit[0]!.every((_, c) => t.unit.some((row) => row[c] === 1)), t.id).toBe(true);
    }
  });
  it("bez ayağı 4 çerçeveye: 1-3 / 2-4", () => {
    const q = applyTemplate(blank(4, 4), templateById("plain").unit, { r0: 0, c0: 0, r1: 3, c1: 3 });
    expect(q).toEqual([[1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1]]);
  });
  it("döner çerçeveler atlanır ve dokunulmaz; şablon kalanlarda sırayla", () => {
    const p = blank(2, 4);
    p[0]![0] = 1;
    const q = applyTemplate(p, templateById("plain").unit, { r0: 0, c0: 0, r1: 1, c1: 3 }, new Set([0]));
    expect(q).toEqual([[1, 1, 0, 1], [0, 0, 1, 0]]);
  });
  it("aralık dışı atkılar korunur, sayacı aralık başından", () => {
    const q = applyTemplate(blank(3, 2), templateById("plain").unit, { r0: 1, c0: 0, r1: 2, c1: 1 });
    expect(q).toEqual([[0, 0], [1, 0], [0, 1]]);
  });
});

describe("atkı / çerçeve ekle-sil", () => {
  const p = [[1, 0], [0, 1]];
  it("atkı ekle/sil", () => {
    expect(insertPicks(p, 1)).toEqual([[1, 0], [0, 0], [0, 1]]);
    expect(deletePicks(p, 0, 0)).toEqual([[0, 1]]);
    expect(insertPicks(blank(512, 2), 0)).toHaveLength(512);
  });
  it("çerçeve ekle/sil, hepsi silinirse boş", () => {
    expect(insertFrames(p, 0)).toEqual([[0, 1, 0], [0, 0, 1]]);
    expect(deleteFrames(p, 1, 1)).toEqual([[1], [0]]);
    expect(deleteFrames(p, 0, 1)).toEqual([]);
    expect(insertFrames(blank(1, 32), 0)[0]).toHaveLength(32);
  });
  it("döner çerçeve numaraları birlikte kayar", () => {
    expect(lenoAfterInsertFrames([1, 2, 5], 1, 2)).toEqual([1, 4, 7]);
    expect(lenoAfterDeleteFrames([1, 2, 5], 1, 2)).toEqual([1, 3]);
  });
});

describe("geri al yığını", () => {
  it("push → undo → redo; yeni push yinele kuyruğunu boşaltır", () => {
    let h = historyInit("a");
    h = historyPush(h, "b");
    h = historyPush(h, "c");
    h = historyUndo(h);
    expect(h.present).toBe("b");
    h = historyRedo(h);
    expect(h.present).toBe("c");
    h = historyUndo(historyPush(historyUndo(h), "x"));
    expect(h.present).toBe("b");
    expect(h.future).toEqual(["x"]); // "c" yinele kuyruğundan düştü
    expect(historyRedo(historyRedo(h)).present).toBe("x");
  });
  it("sürükleme tek adım: replace ara durumları geçmişe yazmaz", () => {
    let h = historyInit("a");
    h = historyReplace(h, "a1");
    h = historyReplace(h, "a2");
    h = historyCommitFrom(h, "a");
    expect(h.past).toEqual(["a"]);
    expect(historyUndo(h).present).toBe("a");
    expect(historyCommitFrom(historyInit("z"), "z").past).toEqual([]);
  });
  it("tavan: eski adımlar düşer", () => {
    let h = historyInit(0);
    for (let i = 1; i <= 5; i++) h = historyPush(h, i, 3);
    expect(h.past).toEqual([2, 3, 4]);
  });
});
