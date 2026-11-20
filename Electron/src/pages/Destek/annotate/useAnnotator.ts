import { useCallback, useRef, useState } from "react";
import {
  addShape,
  canRedo,
  canUndo,
  clampRect,
  clearAll,
  createHistory,
  current,
  rectFrom,
  redo,
  setCrop,
  undo,
  type History,
  type Point,
  type Shape,
  type Tool,
} from "./model";

export const COLORS = ["#ef4444", "#f59e0b", "#2563eb", "#111111"] as const;
export const WIDTHS = [3, 6, 10] as const;

/** Sürüklenen (henüz işlenmemiş) çizim: şekil ya da kırpma çerçevesi. */
export type Draft = { shape: Shape } | { crop: { from: Point; to: Point } } | null;

export interface TextEntry {
  at: Point;
  value: string;
}

function startDraft(tool: Tool, p: Point, color: string, width: number): Draft {
  if (tool === "pen" || tool === "highlight") return { shape: { kind: tool, points: [p], color, width } };
  if (tool === "arrow" || tool === "rect" || tool === "redact") return { shape: { kind: tool, from: p, to: p, color, width } };
  if (tool === "crop") return { crop: { from: p, to: p } };
  return null;
}

function extendDraft(d: Draft, p: Point): Draft {
  if (!d) return d;
  if ("crop" in d) return { crop: { ...d.crop, to: p } };
  const s = d.shape;
  if (s.kind === "pen" || s.kind === "highlight") return { shape: { ...s, points: [...s.points, p] } };
  if (s.kind === "arrow" || s.kind === "rect" || s.kind === "redact") return { shape: { ...s, to: p } };
  return d;
}

/** Şekil anlamlı mı (tıklama kazası değil): oklar/kutular en az 4 px uzanmalı. */
function isMeaningful(s: Shape): boolean {
  if (s.kind === "arrow" || s.kind === "rect" || s.kind === "redact") {
    return Math.abs(s.to.x - s.from.x) + Math.abs(s.to.y - s.from.y) >= 4;
  }
  return true;
}

/** Sürüklenen çizimi bitirir: geçmişe eklenecek adımı döndürür (yoksa geçmiş aynen kalır). */
export function finishDraft(h: History, d: Draft, size: { width: number; height: number }): History {
  if (!d) return h;
  if ("crop" in d) {
    const r = clampRect(rectFrom(d.crop.from, d.crop.to), size.width, size.height);
    return r ? setCrop(h, r) : h;
  }
  return isMeaningful(d.shape) ? addShape(h, d.shape) : h;
}

export function useAnnotator(size: { width: number; height: number }) {
  const [history, setHistory] = useState<History>(createHistory);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState<number>(WIDTHS[0]);
  const [draft, setDraft] = useState<Draft>(null);
  const [text, setTextState] = useState<TextEntry | null>(null);
  // Açık etiketin GÜNCEL değeri: Enter ve blur aynı etiketi iki kez işlemesin diye işlenince hemen boşalır.
  const textRef = useRef<TextEntry | null>(null);
  const setText = useCallback((t: TextEntry | null) => {
    textRef.current = t;
    setTextState(t);
  }, []);

  // ⚠️ Güncelleyici fonksiyonlar SAF kalır (StrictMode onları iki kez çağırır): geçmişe ekleme
  // olay işleyicisinde, o anki değerle tek kez yapılır.
  const commitText = useCallback(() => {
    const t = textRef.current;
    const value = t?.value.trim();
    if (t && value) {
      const shape: Shape = { kind: "text", at: t.at, text: value, color, size: 14 + width * 2 };
      setHistory((h) => addShape(h, shape));
    }
    setText(null);
  }, [color, width, setText]);

  const down = useCallback(
    (p: Point) => {
      if (tool === "text") {
        if (textRef.current) commitText();
        else setText({ at: p, value: "" });
        return;
      }
      setDraft(startDraft(tool, p, color, width));
    },
    [tool, color, width, commitText, setText],
  );

  const move = useCallback((p: Point) => setDraft((d) => extendDraft(d, p)), []);

  const up = useCallback(() => {
    const d = draft;
    setDraft(null);
    if (d) setHistory((h) => finishDraft(h, d, size));
  }, [draft, size]);

  return {
    snapshot: current(history),
    draft,
    text,
    tool,
    color,
    width,
    setTool,
    setColor,
    setWidth,
    setText,
    commitText,
    pointer: { down, move, up },
    undo: () => setHistory(undo),
    redo: () => setHistory(redo),
    clear: () => setHistory(clearAll),
    canUndo: canUndo(history),
    canRedo: canRedo(history),
  };
}

export type Annotator = ReturnType<typeof useAnnotator>;
