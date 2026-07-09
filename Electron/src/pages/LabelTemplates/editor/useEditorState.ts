// =============================================================================
// Etiket Stüdyosu — editör durumu (elemanlar + ÇOKLU seçim + dirty + tek-adım undo)
// =============================================================================
// Seçim modeli: selectedIds (Ctrl+tık toggle / marquee çerçevesi selectMany).
// Jest bütünlüğü: sürükleme/hizalama başında snapshot() alınır; jest boyunca
// updateElementLive/applyPatches snapshot'sız akar → tek "Geri Al" tüm jesti alır.

import { useCallback, useRef, useState } from "react";
import type { CanvasLayout, LabelElement } from "@/types/label-canvas";
import { CANVAS_SCHEMA_VERSION } from "@/types/label-canvas";
import { snap } from "./canvas-model";

export interface EditorState {
  elements: LabelElement[];
  /** Seçili eleman id'leri (sıralı — ilk tık önce). */
  selectedIds: string[];
  dirty: boolean;
  setElements: (els: LabelElement[]) => void;
  /** Tekli seçim (null = temizle). toggle=true → Ctrl+tık üyelik değiştirir. */
  select: (id: string | null, opts?: { toggle?: boolean }) => void;
  /** Marquee sonucu — additive=true mevcut seçimle birleştirir. */
  selectMany: (ids: string[], opts?: { additive?: boolean }) => void;
  addElement: (el: LabelElement) => void;
  /** Birden çok elemanı TEK undo adımıyla ekle (ör. barkod = çubuk + kod metni). */
  addElements: (els: LabelElement[]) => void;
  updateElement: (id: string, patch: Partial<LabelElement>) => void;
  moveElement: (id: string, x: number, y: number) => void;
  /** Snapshot'sız canlı yama — tutamaç/grup sürüklemesi için. */
  updateElementLive: (id: string, patch: Partial<LabelElement>) => void;
  /** Çoklu yama TEK undo adımı olarak (hizala / boşluk eşitle / ok-tuşu grubu). */
  applyPatches: (patches: Record<string, Partial<LabelElement>>) => void;
  removeElement: (id: string) => void;
  /** Seçili TÜM elemanları sil (Delete). */
  removeSelected: () => void;
  /** Jest başlangıcında undo noktası al (değişiklik yapmaz). */
  snapshot: () => void;
  markSaved: () => void;
  loadLayout: (layout: CanvasLayout | null) => void;
  undo: () => void;
  canUndo: boolean;
  layout: CanvasLayout;
}

export function useEditorState(): EditorState {
  const [elements, setEls] = useState<LabelElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const undoRef = useRef<LabelElement[] | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const takeSnapshot = useCallback((current: LabelElement[]) => {
    undoRef.current = current;
    setCanUndo(true);
  }, []);

  const commit = useCallback(
    (next: LabelElement[] | ((prev: LabelElement[]) => LabelElement[])) => {
      setEls((prev) => {
        takeSnapshot(prev);
        setDirty(true);
        return typeof next === "function" ? next(prev) : next;
      });
    },
    [takeSnapshot],
  );

  const select = useCallback((id: string | null, opts?: { toggle?: boolean }) => {
    if (id == null) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds((prev) => {
      if (opts?.toggle) {
        return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      }
      return [id];
    });
  }, []);

  const selectMany = useCallback((ids: string[], opts?: { additive?: boolean }) => {
    setSelectedIds((prev) => (opts?.additive ? [...new Set([...prev, ...ids])] : ids));
  }, []);

  const addElement = useCallback((el: LabelElement) => {
    commit((prev) => [...prev, el]);
    setSelectedIds([el.id]);
  }, [commit]);

  const addElements = useCallback((els: LabelElement[]) => {
    if (els.length === 0) return;
    commit((prev) => [...prev, ...els]);
    setSelectedIds(els.map((e) => e.id));
  }, [commit]);

  const updateElement = useCallback((id: string, patch: Partial<LabelElement>) => {
    commit((prev) => prev.map((e) => (e.id === id ? ({ ...e, ...patch } as LabelElement) : e)));
  }, [commit]);

  const moveElement = useCallback((id: string, x: number, y: number) => {
    setEls((prev) => prev.map((e) => (e.id === id ? { ...e, x: snap(x), y: snap(y) } : e)));
    setDirty(true);
  }, []);

  const updateElementLive = useCallback((id: string, patch: Partial<LabelElement>) => {
    setEls((prev) => prev.map((e) => (e.id === id ? ({ ...e, ...patch } as LabelElement) : e)));
    setDirty(true);
  }, []);

  const applyPatches = useCallback((patches: Record<string, Partial<LabelElement>>) => {
    if (Object.keys(patches).length === 0) return;
    commit((prev) =>
      prev.map((e) => {
        const p = patches[e.id];
        return p ? ({ ...e, ...p } as LabelElement) : e;
      }),
    );
  }, [commit]);

  const removeElement = useCallback((id: string) => {
    commit((prev) => prev.filter((e) => e.id !== id));
    setSelectedIds((s) => s.filter((x) => x !== id));
  }, [commit]);

  const removeSelected = useCallback(() => {
    setSelectedIds((sel) => {
      if (sel.length > 0) {
        const drop = new Set(sel);
        commit((prev) => prev.filter((e) => !drop.has(e.id)));
      }
      return [];
    });
  }, [commit]);

  const snapshot = useCallback(() => {
    setEls((prev) => {
      takeSnapshot(prev);
      return prev;
    });
  }, [takeSnapshot]);

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
    setSelectedIds([]);
    undoRef.current = null;
    setCanUndo(false);
    setDirty(false);
  }, []);

  return {
    elements,
    selectedIds,
    dirty,
    setElements: commit,
    select,
    selectMany,
    addElement,
    addElements,
    updateElement,
    moveElement,
    updateElementLive,
    applyPatches,
    removeElement,
    removeSelected,
    snapshot,
    markSaved: () => setDirty(false),
    loadLayout,
    undo,
    canUndo,
    layout: { v: CANVAS_SCHEMA_VERSION, elements },
  };
}
