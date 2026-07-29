// =============================================================================
// Etiket Stüdyosu — editör durumu (elemanlar + ÇOKLU seçim + dirty + ÇOK-adım undo/redo)
// =============================================================================
// Seçim modeli: selectedIds (Ctrl+tık toggle / marquee çerçevesi selectMany).
// Geçmiş: historyRef (undo yığını) + redoRef (redo yığını), tavan HISTORY_CAP.
// Jest bütünlüğü: sürükleme/hizalama başında snapshot() jest ÖN-durumunu ARMLAR
// (yığına HEMEN yazmaz); ilk gerçek mutasyonda (updateElementLive/moveElement)
// flush edilir → hareketsiz tık boş undo adımı YARATMAZ, jest tek adım kalır.
// Kopyala/yapıştır (Ctrl+C/V) ve çoğalt clipboardRef üzerinden.

import { useCallback, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { CanvasLayout, CanvasPad, LabelElement } from "@/types/label-canvas";
import { CANVAS_SCHEMA_VERSION } from "@/types/label-canvas";
import { snap, newElementId, newGroupId } from "./canvas-model";

/** Undo/redo yığın tavanı — bellek sınırı (eski adımlar düşer). */
const HISTORY_CAP = 100;
/** Kopyala-yapıştır / çoğalt konum kayması (mm). */
const PASTE_OFFSET_MM = 3;

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
  /** Jest başlangıcında undo noktasını ARMLAR (ilk mutasyonda yığına yazılır). */
  snapshot: () => void;
  markSaved: () => void;
  loadLayout: (layout: CanvasLayout | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Seçili elemanları panoya kopyala (Ctrl+C). */
  copySelected: () => void;
  /** Panodakileri kayık konumla yapıştır (Ctrl+V) — yeni id, tek undo adımı. */
  paste: () => void;
  /** Tek elemanı çoğalt (Çoğalt butonu) — kopya seçilir, tek undo adımı. */
  duplicateElement: (id: string) => void;
  /** Seçili (≥2) elemanı grupla — aynı groupId; birlikte seçilir/taşınır. */
  groupSelected: () => void;
  /** Seçili elemanların grubunu çöz (groupId kaldır). */
  ungroupSelected: () => void;
  /** Verilen elemanları dizinin SONUNA al (en üste çizilir — z-sıra). */
  bringToFront: (ids: string[]) => void;
  /** Verilen elemanları dizinin BAŞINA al (en alta çizilir). */
  sendToBack: (ids: string[]) => void;
  /** Elemanı z-sırada BİR adım öne (dizide sonraya) al. */
  moveForward: (id: string) => void;
  /** Elemanı z-sırada BİR adım arkaya (dizide öncesine) al. */
  moveBackward: (id: string) => void;
  /** Katman sürükle-bırak: fromId'yi toId'nin z-sıra konumuna taşı (arrayMove). */
  reorder: (fromId: string, toId: string) => void;
  /** Kağıt-kenarı güvenli-alan boşluğu (mm) — undefined = boşluk yok. */
  pad: CanvasPad | undefined;
  /** Padding'i güncelle (dirty işaretler; hepsi 0 → undefined). */
  setPad: (pad: CanvasPad | undefined) => void;
  layout: CanvasLayout;
}

export function useEditorState(): EditorState {
  const [elements, setEls] = useState<LabelElement[]>([]);
  const [pad, setPadState] = useState<CanvasPad | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const historyRef = useRef<LabelElement[][]>([]); // undo yığını (geçmiş durumlar)
  const redoRef = useRef<LabelElement[][]>([]); // redo yığını (ileri durumlar)
  const pendingRef = useRef<LabelElement[] | null>(null); // ARMlanmış jest ön-durumu
  const clipboardRef = useRef<LabelElement[]>([]); // Ctrl+C panosu
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /** Bir ön-durumu undo yığınına it (tavan uygula, redo'yu geçersiz kıl).
   *  commit updater'ından çağrılıyor → StrictMode çift-invoke AYNI referansı iki kez
   *  iletir; referans-dedup (top === prevState) tek kayıt tutar (yoksa tek işlem 2 undo). */
  const pushHistory = useCallback((prevState: LabelElement[]) => {
    const h = historyRef.current;
    if (h[h.length - 1] === prevState) return;
    h.push(prevState);
    if (h.length > HISTORY_CAP) h.shift();
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  /** ARMlanmış jest ön-durumu varsa yığına yaz (ilk mutasyonda çağrılır). */
  const flushPending = useCallback(() => {
    if (pendingRef.current) {
      pushHistory(pendingRef.current);
      pendingRef.current = null;
    }
  }, [pushHistory]);

  const commit = useCallback(
    (next: LabelElement[] | ((prev: LabelElement[]) => LabelElement[])) => {
      setEls((prev) => {
        pendingRef.current = null; // ayrık işlem bekleyen jest snapshot'ını ezer
        pushHistory(prev);
        setDirty(true);
        return typeof next === "function" ? next(prev) : next;
      });
    },
    [pushHistory],
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
    flushPending();
    setEls((prev) => prev.map((e) => (e.id === id ? { ...e, x: snap(x), y: snap(y) } : e)));
    setDirty(true);
  }, [flushPending]);

  const updateElementLive = useCallback((id: string, patch: Partial<LabelElement>) => {
    flushPending();
    setEls((prev) => prev.map((e) => (e.id === id ? ({ ...e, ...patch } as LabelElement) : e)));
    setDirty(true);
  }, [flushPending]);

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
    // Yığına YAZMAZ — jest ön-durumunu ARMLAR; ilk mutasyon flushPending ile yazar
    // (hareketsiz tık boş undo adımı yaratmasın). Jest başında ezilir → bayat kalmaz.
    setEls((prev) => {
      pendingRef.current = prev;
      return prev;
    });
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prevState = historyRef.current.pop()!;
    pendingRef.current = null;
    // setEls updater StrictMode'da çift-invoke → redo push'u referans-dedup'lı (mükerrer olmasın).
    setEls((cur) => {
      const r = redoRef.current;
      if (r[r.length - 1] !== cur) r.push(cur);
      return prevState;
    });
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const nextState = redoRef.current.pop()!;
    pendingRef.current = null;
    setEls((cur) => {
      const h = historyRef.current;
      if (h[h.length - 1] !== cur) h.push(cur);
      return nextState;
    });
    setCanRedo(redoRef.current.length > 0);
    setCanUndo(true);
    setDirty(true);
  }, []);

  const copySelected = useCallback(() => {
    const sel = new Set(selectedIds);
    clipboardRef.current = elements.filter((e) => sel.has(e.id)).map((e) => ({ ...e }));
  }, [elements, selectedIds]);

  const paste = useCallback(() => {
    const clip = clipboardRef.current;
    if (clip.length === 0) return;
    // Kopyalar KENDİ aralarında YENİ grup olur (orijinal gruba DAHİL OLMAZ): her eski
    // groupId yeni bir groupId'ye eşlenir → grup yapısı kopyalar arasında korunur ama
    // orijinallerden kopar (kullanıcı isteği: kopya = ayrı grup).
    const remap = new Map<string, string>();
    const clones = clip.map((e) => {
      const clone = { ...e, id: newElementId(e.type), x: snap(e.x + PASTE_OFFSET_MM), y: snap(e.y + PASTE_OFFSET_MM) } as LabelElement;
      if (e.groupId) {
        let ng = remap.get(e.groupId);
        if (!ng) { ng = newGroupId(); remap.set(e.groupId, ng); }
        clone.groupId = ng;
      }
      return clone;
    });
    commit((prev) => [...prev, ...clones]);
    setSelectedIds(clones.map((c) => c.id));
  }, [commit]);

  const duplicateElement = useCallback(
    (id: string) => {
      const el = elements.find((e) => e.id === id);
      if (!el) return;
      // Tek kopya → orijinal gruba dahil olmaz (tek eleman "grup" olamaz); groupId atılır.
      const clone = { ...el, id: newElementId(el.type), x: snap(el.x + PASTE_OFFSET_MM), y: snap(el.y + PASTE_OFFSET_MM) } as LabelElement;
      delete (clone as { groupId?: string }).groupId;
      commit((prev) => [...prev, clone]);
      setSelectedIds([clone.id]);
    },
    [elements, commit],
  );

  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    const gid = newGroupId();
    const sel = new Set(selectedIds);
    commit((prev) => prev.map((e) => (sel.has(e.id) ? ({ ...e, groupId: gid } as LabelElement) : e)));
  }, [selectedIds, commit]);

  const ungroupSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const sel = new Set(selectedIds);
    commit((prev) =>
      prev.map((e) => {
        if (!sel.has(e.id) || !e.groupId) return e;
        const copy = { ...e };
        delete (copy as { groupId?: string }).groupId;
        return copy;
      }),
    );
  }, [selectedIds, commit]);

  const bringToFront = useCallback((ids: string[]) => {
    const set = new Set(ids);
    if (set.size === 0) return;
    commit((prev) => [...prev.filter((e) => !set.has(e.id)), ...prev.filter((e) => set.has(e.id))]);
  }, [commit]);

  const sendToBack = useCallback((ids: string[]) => {
    const set = new Set(ids);
    if (set.size === 0) return;
    commit((prev) => [...prev.filter((e) => set.has(e.id)), ...prev.filter((e) => !set.has(e.id))]);
  }, [commit]);

  const moveForward = useCallback((id: string) => {
    const i = elements.findIndex((e) => e.id === id);
    if (i < 0 || i === elements.length - 1) return; // zaten en üstte → no-op (undo kirletme)
    commit((prev) => {
      const j = prev.findIndex((e) => e.id === id);
      if (j < 0 || j === prev.length - 1) return prev;
      const n = [...prev];
      [n[j], n[j + 1]] = [n[j + 1]!, n[j]!];
      return n;
    });
  }, [elements, commit]);

  const moveBackward = useCallback((id: string) => {
    const i = elements.findIndex((e) => e.id === id);
    if (i <= 0) return; // zaten en altta → no-op
    commit((prev) => {
      const j = prev.findIndex((e) => e.id === id);
      if (j <= 0) return prev;
      const n = [...prev];
      [n[j], n[j - 1]] = [n[j - 1]!, n[j]!];
      return n;
    });
  }, [elements, commit]);

  const reorder = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = elements.findIndex((e) => e.id === fromId);
    const to = elements.findIndex((e) => e.id === toId);
    if (from < 0 || to < 0) return; // boundary/no-op guard → boş undo adımı yok
    commit((prev) => {
      const f = prev.findIndex((e) => e.id === fromId);
      const t = prev.findIndex((e) => e.id === toId);
      if (f < 0 || t < 0 || f === t) return prev;
      return arrayMove(prev, f, t);
    });
  }, [elements, commit]);

  const setPad = useCallback((p: CanvasPad | undefined) => {
    // Hepsi 0 → undefined (saklanmaz; backend parseCanvasPad ile aynı davranış).
    setPadState(p && (p.top || p.right || p.bottom || p.left) ? p : undefined);
    setDirty(true);
  }, []);

  const loadLayout = useCallback((layout: CanvasLayout | null) => {
    setEls(layout?.elements ?? []);
    setPadState(layout?.pad);
    setSelectedIds([]);
    historyRef.current = [];
    redoRef.current = [];
    pendingRef.current = null;
    setCanUndo(false);
    setCanRedo(false);
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
    redo,
    canUndo,
    canRedo,
    copySelected,
    paste,
    duplicateElement,
    groupSelected,
    ungroupSelected,
    bringToFront,
    sendToBack,
    moveForward,
    moveBackward,
    reorder,
    pad,
    setPad,
    layout: { v: CANVAS_SCHEMA_VERSION, elements, ...(pad ? { pad } : {}) },
  };
}
