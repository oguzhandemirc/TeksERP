import { describe, expect, it } from "vitest";
import {
  addShape,
  canRedo,
  canUndo,
  clampRect,
  clearAll,
  createHistory,
  current,
  fitWithin,
  redo,
  setCrop,
  undo,
  type Shape,
} from "./model";
import { finishDraft } from "./useAnnotator";

const pen = (n: number): Shape => ({ kind: "pen", points: [{ x: n, y: n }], color: "#ef4444", width: 3 });

describe("çizim geçmişi — geri al / yinele", () => {
  it("boş geçmişte geri al ve yinele kapalı", () => {
    const h = createHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
  });

  it("geri al son şekli kaldırır, yinele geri getirir", () => {
    let h = addShape(addShape(createHistory(), pen(1)), pen(2));
    h = undo(h);
    expect(current(h).shapes).toEqual([pen(1)]);
    h = redo(h);
    expect(current(h).shapes).toEqual([pen(1), pen(2)]);
    expect(canRedo(h)).toBe(false);
  });

  it("geri aldıktan sonra yeni çizim ileri dalı keser", () => {
    let h = addShape(addShape(createHistory(), pen(1)), pen(2));
    h = addShape(undo(h), pen(3));
    expect(current(h).shapes).toEqual([pen(1), pen(3)]);
    expect(canRedo(h)).toBe(false);
  });

  it("temizle geri alınabilir; boşken adım eklemez", () => {
    const empty = createHistory();
    expect(clearAll(empty)).toBe(empty);
    let h = clearAll(addShape(empty, pen(1)));
    expect(current(h).shapes).toEqual([]);
    h = undo(h);
    expect(current(h).shapes).toEqual([pen(1)]);
  });

  it("kırpma da bir adımdır ve geri alınır", () => {
    let h = setCrop(addShape(createHistory(), pen(1)), { x: 10, y: 10, w: 100, h: 50 });
    expect(current(h).crop).toEqual({ x: 10, y: 10, w: 100, h: 50 });
    h = undo(h);
    expect(current(h).crop).toBeNull();
    expect(current(h).shapes).toHaveLength(1);
  });
});

describe("sürükleme bitişi ve ölçü", () => {
  const size = { width: 800, height: 600 };

  it("tıklama kazası (uzanmayan kutu) geçmişe girmez", () => {
    const h = createHistory();
    const d = { shape: { kind: "rect" as const, from: { x: 5, y: 5 }, to: { x: 6, y: 6 }, color: "#000", width: 3 } };
    expect(finishDraft(h, d, size)).toBe(h);
  });

  it("kırpma görüntü sınırına kırpılır; çok küçük kırpma yok sayılır", () => {
    const h = finishDraft(createHistory(), { crop: { from: { x: 700, y: 500 }, to: { x: 900, y: 900 } } }, size);
    expect(current(h).crop).toEqual({ x: 700, y: 500, w: 100, h: 100 });
    expect(clampRect({ x: 1, y: 1, w: 4, h: 50 }, 800, 600)).toBeNull();
  });

  it("uzun kenar 1920'yi aşarsa orantılı küçülür, küçükse büyütülmez", () => {
    expect(fitWithin(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080, scale: 0.5 });
    expect(fitWithin(1280, 720, 1920)).toEqual({ width: 1280, height: 720, scale: 1 });
    expect(fitWithin(1000, 4000, 1920).height).toBe(1920);
  });
});
