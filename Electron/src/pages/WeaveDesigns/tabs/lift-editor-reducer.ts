// Armür editörünün durum makinesi: geri al yığını (armür + döner çerçeveler birlikte), seçim, imleç, pano,
// sürükleme vuruşu. Saf (useReducer); işlemlerin kendisi `lift-plan-edit.ts`. Seçim yoksa işlem bütün ızgaraya.
import type { WeaveDirection } from "@/components/weave/weave-direction";
import {
  applyTemplate, cellsOnLine, clampRect, clearBlock, copyRect, deleteFrames, deletePicks, flipFrames, flipPicks, frameCountOf,
  fullRect, historyCommitFrom, historyInit, historyPush, historyRedo, historyReplace, historyUndo, insertFrames, insertPicks,
  invertBlock, lenoAfterDeleteFrames, lenoAfterInsertFrames, mapRect, normRect, pasteAt, repeatRect, setCells, shiftBlock,
  templateById, type Block, type Cell, type History, type Rect, type WeaveTemplateId,
} from "../lift-plan-edit";
import { cycleFrameRole, lenoWithin, resizeLiftPlan, toggleLenoFrame } from "../lift-plan";
import type { LiftPlan } from "../types";

/** `selv` = kenar çerçeveleri (1-tabanlı); döner gibi ızgara yapısıyla birlikte kayar/kırpılır. */
export interface Snap { plan: LiftPlan; leno: number[]; selv: number[] }
export type Tool = "paint" | "select";
interface Stroke { mode: Tool; base: Snap; value: 0 | 1; last: Cell }

export interface EditorState {
  hist: History<Snap>;
  sel: Rect | null;
  /** Seçimin sabit köşesi (Shift+ok / sürükle). */
  anchor: Cell | null;
  cursor: Cell;
  clip: Block | null;
  tool: Tool;
  stroke: Stroke | null;
}

export type BlockOp = "flipPicks" | "flipFrames" | "invert" | "clear";
export type EditorAction =
  | { type: "down"; cell: Cell; select?: boolean }
  | { type: "enter"; cell: Cell }
  | { type: "up" }
  | { type: "cursor"; cell: Cell; extend?: boolean }
  | { type: "toggleCursor" }
  | { type: "toggleLeno"; frame: number }
  /** Başlık tıklaması: zemin → döner → kenar → zemin. */
  | { type: "cycleFrame"; frame: number }
  | { type: "undo" } | { type: "redo" }
  | { type: "selectAll" } | { type: "clearSel" }
  | { type: "copy" } | { type: "cut" } | { type: "paste" }
  | { type: "block"; op: BlockOp }
  | { type: "shift"; dr: number; dc: number }
  | { type: "repeat"; axis: "picks" | "frames" }
  | { type: "template"; id: WeaveTemplateId }
  | { type: "insertPicks" } | { type: "deletePicks" } | { type: "insertFrames" } | { type: "deleteFrames" }
  | { type: "resize"; picks: number; frames: number }
  /** Kayıtlı hâle dön (Vazgeç) — geri alınabilir adım. */
  | { type: "load"; snap: Snap }
  | { type: "tool"; tool: Tool };

export function initEditor(plan: LiftPlan, leno: number[], selv: number[] = []): EditorState {
  return { hist: historyInit({ plan, leno, selv }), sel: null, anchor: null, cursor: { r: 0, c: 0 }, clip: null, tool: "paint", stroke: null };
}

const present = (s: EditorState) => s.hist.present;
/** Işlem hedefi: seçim (ızgaraya kırpılmış) yoksa bütün ızgara. */
export const targetRect = (s: EditorState): Rect | null => (s.sel ? clampRect(present(s).plan, s.sel) : fullRect(present(s).plan));

function commit(s: EditorState, next: Snap): EditorState {
  return next.plan === present(s).plan && next.leno === present(s).leno && next.selv === present(s).selv ? s : { ...s, hist: historyPush(s.hist, next) };
}
const commitPlan = (s: EditorState, plan: LiftPlan) => commit(s, { ...present(s), plan });

function clampCell(plan: LiftPlan, cell: Cell): Cell {
  return { r: Math.max(0, Math.min(plan.length - 1, cell.r)), c: Math.max(0, Math.min(frameCountOf(plan) - 1, cell.c)) };
}

function pointer(s: EditorState, a: Extract<EditorAction, { type: "down" | "enter" | "up" }>): EditorState {
  const { plan } = present(s);
  if (a.type === "down") {
    if (a.select || s.tool === "select") {
      return { ...s, cursor: a.cell, anchor: a.cell, sel: normRect(a.cell, a.cell), stroke: { mode: "select", base: present(s), value: 1, last: a.cell } };
    }
    const value = plan[a.cell.r]?.[a.cell.c] === 1 ? 0 : 1;
    const next = setCells(plan, [a.cell], value);
    return { ...s, cursor: a.cell, sel: null, hist: historyReplace(s.hist, { ...present(s), plan: next }), stroke: { mode: "paint", base: present(s), value, last: a.cell } };
  }
  const st = s.stroke;
  if (!st) return s;
  if (a.type === "up") return { ...s, stroke: null, hist: st.mode === "paint" ? historyCommitFrom(s.hist, st.base) : s.hist };
  if (st.last.r === a.cell.r && st.last.c === a.cell.c) return s;
  if (st.mode === "select") return { ...s, cursor: a.cell, sel: normRect(s.anchor ?? a.cell, a.cell), stroke: { ...st, last: a.cell } };
  const next = setCells(plan, cellsOnLine(st.last, a.cell), st.value);
  return { ...s, cursor: a.cell, hist: historyReplace(s.hist, { ...present(s), plan: next }), stroke: { ...st, last: a.cell } };
}

function blockOps(s: EditorState, a: Extract<EditorAction, { type: "block" | "shift" | "repeat" | "template" }>): EditorState {
  const { plan, leno, selv } = present(s);
  const rect = targetRect(s);
  if (!rect) return s;
  if (a.type === "repeat") return commitPlan(s, repeatRect(plan, rect, a.axis));
  if (a.type === "shift") return commitPlan(s, mapRect(plan, rect, (b) => shiftBlock(b, a.dr, a.dc)));
  if (a.type === "template") {
    // Hazır örgü yalnız zemine basılır: döner ve kenar sütunları atlanır.
    const skip = new Set(lenoWithin([...leno, ...selv], frameCountOf(plan)).map((f) => f - 1));
    return commitPlan(s, applyTemplate(plan, templateById(a.id).unit, rect, skip));
  }
  const fn = { flipPicks, flipFrames, invert: invertBlock, clear: clearBlock }[a.op];
  return commitPlan(s, mapRect(plan, rect, fn));
}

function clipboard(s: EditorState, a: Extract<EditorAction, { type: "copy" | "cut" | "paste" }>): EditorState {
  const { plan } = present(s);
  if (a.type === "paste") {
    if (!s.clip) return s;
    const at = s.sel ? { r: s.sel.r0, c: s.sel.c0 } : s.cursor;
    return commitPlan(s, pasteAt(plan, s.clip, at));
  }
  const rect = targetRect(s);
  if (!rect) return s;
  const withClip = { ...s, clip: copyRect(plan, rect) };
  return a.type === "cut" ? commitPlan(withClip, mapRect(plan, rect, clearBlock)) : withClip;
}

function structure(s: EditorState, a: Extract<EditorAction, { type: "insertPicks" | "deletePicks" | "insertFrames" | "deleteFrames" }>): EditorState {
  const { plan, leno, selv } = present(s);
  if (plan.length === 0) return s;
  const rows = s.sel ? { lo: s.sel.r0, hi: s.sel.r1 } : { lo: s.cursor.r, hi: s.cursor.r };
  const cols = s.sel ? { lo: s.sel.c0, hi: s.sel.c1 } : { lo: s.cursor.c, hi: s.cursor.c };
  let next: Snap;
  if (a.type === "insertPicks") next = { plan: insertPicks(plan, rows.hi + 1, rows.hi - rows.lo + 1), leno, selv };
  else if (a.type === "deletePicks") next = { plan: deletePicks(plan, rows.lo, rows.hi), leno, selv };
  else if (a.type === "insertFrames") {
    const p = insertFrames(plan, cols.hi + 1, cols.hi - cols.lo + 1);
    const n = frameCountOf(p) - frameCountOf(plan);
    next = { plan: p, leno: lenoAfterInsertFrames(leno, cols.hi + 1, n), selv: lenoAfterInsertFrames(selv, cols.hi + 1, n) };
  } else {
    const p = deleteFrames(plan, cols.lo, cols.hi);
    const empty = p.length === 0;
    next = { plan: p, leno: empty ? [] : lenoAfterDeleteFrames(leno, cols.lo, cols.hi), selv: empty ? [] : lenoAfterDeleteFrames(selv, cols.lo, cols.hi) };
  }
  const out = commit({ ...s, sel: null }, next);
  return next.plan.length === 0 ? out : { ...out, cursor: clampCell(next.plan, s.cursor) };
}

function navigation(s: EditorState, a: Extract<EditorAction, { type: "cursor" | "toggleCursor" | "selectAll" | "clearSel" }>): EditorState {
  const { plan } = present(s);
  if (plan.length === 0) return s;
  if (a.type === "selectAll") return { ...s, sel: fullRect(plan), anchor: { r: 0, c: 0 } };
  if (a.type === "clearSel") return { ...s, sel: null, anchor: null };
  if (a.type === "toggleCursor") {
    const { r, c } = s.cursor;
    return commitPlan(s, setCells(plan, [s.cursor], plan[r]?.[c] === 1 ? 0 : 1));
  }
  const cell = clampCell(plan, a.cell);
  if (!a.extend) return { ...s, cursor: cell, sel: null, anchor: null };
  const anchor = s.anchor ?? s.cursor;
  return { ...s, cursor: cell, anchor, sel: normRect(anchor, cell) };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "down": case "enter": case "up": return pointer(s, a);
    case "block": case "shift": case "repeat": case "template": return blockOps(s, a);
    case "copy": case "cut": case "paste": return clipboard(s, a);
    case "insertPicks": case "deletePicks": case "insertFrames": case "deleteFrames": return structure(s, a);
    case "cursor": case "toggleCursor": case "selectAll": case "clearSel": return navigation(s, a);
    case "undo": return { ...s, hist: historyUndo(s.hist), sel: null };
    case "redo": return { ...s, hist: historyRedo(s.hist), sel: null };
    case "tool": return { ...s, tool: a.tool };
    case "load": return { ...commit(s, a.snap), sel: null, anchor: null, cursor: { r: 0, c: 0 } };
    case "toggleLeno": return commit(s, { ...present(s), leno: toggleLenoFrame(present(s).leno, a.frame) });
    case "cycleFrame": return commit(s, { ...present(s), ...cycleFrameRole(present(s).leno, present(s).selv, a.frame) });
    case "resize": {
      const plan = resizeLiftPlan(present(s).plan, a.picks, a.frames);
      const n = frameCountOf(plan);
      return { ...commit(s, { plan, leno: lenoWithin(present(s).leno, n), selv: lenoWithin(present(s).selv, n) }), sel: null, cursor: { r: 0, c: 0 } };
    }
  }
}

export interface KeyLike { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

/** Klavye → eylem. Yukarı ok ekranda yukarı: alttan yukarı görünümde sonraki atkı. Tanınmayan tuş null. */
export function keyToAction(e: KeyLike, dir: WeaveDirection, cursor: Cell): EditorAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod) {
    if (k === "z") return { type: e.shiftKey ? "redo" : "undo" };
    if (k === "y") return { type: "redo" };
    if (k === "c") return { type: "copy" };
    if (k === "x") return { type: "cut" };
    if (k === "v") return { type: "paste" };
    if (k === "a") return { type: "selectAll" };
    return null;
  }
  const up = dir === "bottom-up" ? 1 : -1;
  const moves: Record<string, Cell> = {
    arrowup: { r: cursor.r + up, c: cursor.c }, arrowdown: { r: cursor.r - up, c: cursor.c },
    arrowleft: { r: cursor.r, c: cursor.c - 1 }, arrowright: { r: cursor.r, c: cursor.c + 1 },
  };
  if (moves[k]) return { type: "cursor", cell: moves[k], extend: e.shiftKey };
  if (k === " " || k === "enter") return { type: "toggleCursor" };
  if (k === "delete" || k === "backspace") return { type: "block", op: "clear" };
  if (k === "escape") return { type: "clearSel" };
  return null;
}
