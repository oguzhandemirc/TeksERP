// =============================================================================
// Etiket Stüdyosu — editör durumu (elemanlar + seçim + dirty + tek-adım undo)
// =============================================================================

import { useCallback, useRef, useState } from "react";
import type { CanvasLayout, LabelElement } from "@/types/label-canvas";
import { CANVAS_SCHEMA_VERSION } from "@/types/label-canvas";
import { snap } from "./canvas-model";

export interface EditorState {
  elements: LabelElement[];
  selectedId: string | null;
  dirty: boolean;
  setElements: (els: LabelElement[]) => void;
  select: (id: string | null) => void;
  addElement: (el: LabelElement) => void;
  updateElement: (id: string, patch: Partial<LabelElement>) => void;
  moveElement: (id: string, x: number, y: number) => void;
  removeElement: (id: string) => void;
  /** Kaydetten sonra çağrılır — dirty sıfırlanır. */
  markSaved: () => void;
  /** Varyant değişince yerleşimi topluca yükle (dirty sıfırlanır). */
  loadLayout: (layout: CanvasLayout | null) => void;
  undo: () => void;
  canUndo: boolean;
  layout: CanvasLayout;
}

export function useEditorState(): EditorState {
  const [elements, setEls] = useState<LabelElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const undoRef = useRef<LabelElement[] | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const commit = useCallback((next: LabelElement[] | ((prev: LabelElement[]) => LabelElement[])) => {
    setEls((prev) => {
      undoRef.current = prev;
      setCanUndo(true);
      setDirty(true);
      return typeof next === "function" ? next(prev) : next;
    });
  }, []);

  const addElement = useCallback((el: LabelElement) => {
    commit((prev) => [...prev, el]);
    setSelectedId(el.id);
  }, [commit]);

  const updateElement = useCallback((id: string, patch: Partial<LabelElement>) => {
    commit((prev) => prev.map((e) => (e.id === id ? ({ ...e, ...patch } as LabelElement) : e)));
  }, [commit]);

  const moveElement = useCallback((id: string, x: number, y: number) => {
    // Sürükleme sırasında sık çağrılır — undo anlık noktası sürükleme başında
    // alınmıştır (CanvasStage pointerdown'da updateElement yerine bunu kullanır).
    setEls((prev) => prev.map((e) => (e.id === id ? { ...e, x: snap(x), y: snap(y) } : e)));
    setDirty(true);
  }, []);

  const removeElement = useCallback((id: string) => {
    commit((prev) => prev.filter((e) => e.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  }, [commit]);

  const undo = useCallback(() => {
    if (undoRef.current) {
      setEls(undoRef.current);
      undoRef.current = null;
      setCanUndo(false);
      setDirty(true);
    }
  }, []);

  const loadLayout = useCallback((layout: CanvasLayout | null) => {
    setEls(layout?.elements ?? []);
    setSelectedId(null);
    undoRef.current = null;
    setCanUndo(false);
    setDirty(false);
  }, []);

  return {
    elements,
    selectedId,
    dirty,
    setElements: commit,
    select: setSelectedId,
    addElement,
    updateElement,
    moveElement,
    removeElement,
    markSaved: () => setDirty(false),
    loadLayout,
    undo,
    canUndo,
    layout: { v: CANVAS_SCHEMA_VERSION, elements },
  };
}
