import { describe, expect, it } from "vitest";
import { editorReducer, initEditor, keyToAction, type EditorAction, type EditorState } from "./lift-editor-reducer";

const blank = (picks: number, frames: number) => Array.from({ length: picks }, () => new Array<number>(frames).fill(0));
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const plan = (s: EditorState) => s.hist.present.plan;

describe("sürükle-boya vuruşu", () => {
  it("boş hücreden başlayan sürükleme boyar, tek geri al adımı", () => {
    let s = run(initEditor(blank(3, 4), []), { type: "down", cell: { r: 0, c: 0 } }, { type: "enter", cell: { r: 0, c: 3 } }, { type: "up" });
    expect(plan(s)[0]).toEqual([1, 1, 1, 1]);
    expect(s.hist.past).toHaveLength(1);
    s = run(s, { type: "undo" });
    expect(plan(s)[0]).toEqual([0, 0, 0, 0]);
    expect(run(s, { type: "redo" }).hist.present.plan[0]).toEqual([1, 1, 1, 1]);
  });
  it("dolu hücreden başlayan sürükleme siler", () => {
    const start = [[1, 1, 1], [0, 0, 0]];
    const s = run(initEditor(start, []), { type: "down", cell: { r: 0, c: 1 } }, { type: "enter", cell: { r: 1, c: 1 } }, { type: "up" });
    expect(plan(s)).toEqual([[1, 0, 1], [0, 0, 0]]);
  });
  it("Shift ile basılı sürükleme seçer, armürü değiştirmez", () => {
    const s = run(initEditor(blank(4, 4), []), { type: "down", cell: { r: 1, c: 1 }, select: true }, { type: "enter", cell: { r: 2, c: 3 } }, { type: "up" });
    expect(s.sel).toEqual({ r0: 1, r1: 2, c0: 1, c1: 3 });
    expect(s.hist.past).toHaveLength(0);
  });
});

describe("seçim işlemleri", () => {
  it("kopyala → başka yere yapıştır", () => {
    const s = run(initEditor([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], []),
      { type: "down", cell: { r: 0, c: 0 }, select: true }, { type: "enter", cell: { r: 1, c: 1 } }, { type: "up" }, { type: "copy" },
      { type: "cursor", cell: { r: 2, c: 2 } }, { type: "paste" });
    expect(plan(s).slice(2)).toEqual([[0, 0, 1, 0], [0, 0, 0, 1]]);
  });
  it("seçim yokken şablon bütün ızgaraya, döner çerçeveye dokunmaz", () => {
    const s = run(initEditor(blank(2, 3), [1]), { type: "template", id: "plain" });
    expect(plan(s)).toEqual([[0, 1, 0], [0, 0, 1]]);
  });
  it("çerçeve silinince döner işaretleri kayar", () => {
    const s = run(initEditor(blank(2, 4), [4]), { type: "cursor", cell: { r: 0, c: 1 } }, { type: "deleteFrames" });
    expect(s.hist.present.leno).toEqual([3]);
    expect(plan(s)[0]).toHaveLength(3);
  });
  it("atkı ekle seçili satırların sonrasına seçim kadar", () => {
    const s = run(initEditor([[1], [1]], []), { type: "cursor", cell: { r: 0, c: 0 } }, { type: "insertPicks" });
    expect(plan(s)).toEqual([[1], [0], [1]]);
  });
});

describe("klavye", () => {
  const k = (key: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) =>
    ({ key, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });
  it("yukarı ok alttan yukarı görünümde sonraki atkıya gider", () => {
    expect(keyToAction(k("ArrowUp"), "bottom-up", { r: 2, c: 0 })).toEqual({ type: "cursor", cell: { r: 3, c: 0 }, extend: false });
    expect(keyToAction(k("ArrowUp"), "top-down", { r: 2, c: 0 })).toEqual({ type: "cursor", cell: { r: 1, c: 0 }, extend: false });
  });
  it("Ctrl/Cmd kısayolları", () => {
    expect(keyToAction(k("z", { ctrlKey: true }), "top-down", { r: 0, c: 0 })).toEqual({ type: "undo" });
    expect(keyToAction(k("Z", { metaKey: true, shiftKey: true }), "top-down", { r: 0, c: 0 })).toEqual({ type: "redo" });
    expect(keyToAction(k("y", { ctrlKey: true }), "top-down", { r: 0, c: 0 })).toEqual({ type: "redo" });
    expect(keyToAction(k("q"), "top-down", { r: 0, c: 0 })).toBeNull();
  });
  it("imleç ızgara dışına çıkmaz", () => {
    const s = run(initEditor(blank(2, 2), []), { type: "cursor", cell: { r: 9, c: -3 } });
    expect(s.cursor).toEqual({ r: 1, c: 0 });
  });
});
