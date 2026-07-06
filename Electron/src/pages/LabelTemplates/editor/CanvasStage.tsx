// =============================================================================
// Etiket Stüdyosu — kanvas sahnesi (mm tuval + zoom + çoklu seçim + sürükle)
// =============================================================================
// Saf pointer-event (ek bağımlılık yok). Seçim: tık=tekli, Ctrl/Cmd+tık=toggle,
// boş alandan sürükle=çerçeve (marquee; Ctrl=mevcuda ekle), Ctrl+A=tümü.
// Grup taşıma: seçili herhangi birini sürükle → hepsi birlikte (0.5mm snap).
// Tutamaçlar (boyut/döndür) yalnız TEKLİ seçimde. Delete=seçileni sil,
// oklar=0.5mm (Shift=2mm) it. Görsel YAKLAŞIKTIR — gerçek çıktı backend
// önizlemesinde. Her jest tek undo adımıdır (snapshot jest başında).

import { useRef, useState } from "react";
import { ZoomIn, ZoomOut, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LabelElement } from "@/types/label-canvas";
import {
  alignElements,
  applyResize,
  clamp,
  distributeElements,
  estimateBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  snap,
  snapRotation,
  type AlignMode,
  type DistributeMode,
} from "./canvas-model";
import { CanvasElementView, type HandleMode } from "./CanvasElementView";
import { AlignmentToolbar } from "./AlignmentToolbar";
import type { EditorState } from "./useEditorState";
import type { LintIssue } from "./useCanvasLint";

interface Props {
  canvas: { widthMm: number; heightMm: number };
  state: EditorState;
  zoom: number;
  onZoom: (z: number) => void;
  lint: LintIssue[];
}

type DragState =
  | { mode: "move"; ids: string[]; startCursor: { x: number; y: number }; startPos: Record<string, { x: number; y: number }> }
  | { mode: HandleMode; id: string }
  | { mode: "marquee"; additive: boolean; start: { x: number; y: number }; current: { x: number; y: number } };

export function CanvasStage({ canvas, state, zoom, onZoom, lint }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const warnIds = new Set(lint.filter((i) => i.level !== "info" && i.elementId).map((i) => i.elementId));

  const mmFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  };

  const onElementPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    stageRef.current?.focus();
    // Ctrl/Cmd+tık: üyelik toggle — sürükleme başlatmaz.
    if (e.ctrlKey || e.metaKey) {
      state.select(id, { toggle: true });
      return;
    }
    // Seçili bir elemana basıldıysa GRUP taşınır; değilse tekli seçilip taşınır.
    const ids = state.selectedIds.includes(id) ? state.selectedIds : [id];
    if (!state.selectedIds.includes(id)) state.select(id);
    state.snapshot(); // jest başı undo noktası
    const at = mmFromEvent(e);
    const startPos: Record<string, { x: number; y: number }> = {};
    for (const el of state.elements) if (ids.includes(el.id)) startPos[el.id] = { x: el.x, y: el.y };
    setDrag({ mode: "move", ids, startCursor: at, startPos });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  // Köşe (boyutlandır) / döndür tutamacı — yalnız tekli seçimde görünür.
  const onHandlePointerDown = (e: React.PointerEvent, id: string, mode: HandleMode) => {
    e.stopPropagation();
    state.select(id);
    state.snapshot();
    setDrag({ mode, id });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  // Boş alandan sürükleme = marquee çerçevesi (Ctrl → mevcut seçime EKLE).
  const onStagePointerDown = (e: React.PointerEvent) => {
    const at = mmFromEvent(e);
    const additive = e.ctrlKey || e.metaKey;
    if (!additive) state.select(null);
    setDrag({ mode: "marquee", additive, start: at, current: at });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const at = mmFromEvent(e);

    if (drag.mode === "move") {
      const dx = at.x - drag.startCursor.x;
      const dy = at.y - drag.startCursor.y;
      for (const id of drag.ids) {
        const start = drag.startPos[id];
        if (!start) continue;
        state.updateElementLive(id, {
          x: clamp(snap(start.x + dx), 0, canvas.widthMm - 1),
          y: clamp(snap(start.y + dy), 0, canvas.heightMm - 1),
        });
      }
      return;
    }
    if (drag.mode === "marquee") {
      setDrag({ ...drag, current: at });
      return;
    }

    const el = state.elements.find((x) => x.id === drag.id);
    if (!el) return;
    if (drag.mode === "resize") {
      // Hedef kutu = elemanın sol-üstünden imlece; tip kendi "boyut" anlamına çevirir
      // (metin→font kademesi, QR→ölçek, barkod→bar yüksekliği — applyResize).
      const patch = applyResize(el, at.x - el.x, at.y - el.y);
      if (patch) state.updateElementLive(drag.id, patch);
      return;
    }
    // rotate: eleman merkezine göre imleç açısı → 90° adıma oturt (yazıcı sınırı).
    const b = estimateBounds(el, canvas);
    const deg = (Math.atan2(at.y - (el.y + b.h / 2), at.x - (el.x + b.w / 2)) * 180) / Math.PI + 90;
    const rot = snapRotation(deg);
    if ((el.type === "field" || el.type === "text") && rot !== (el.rot ?? 0)) {
      state.updateElementLive(drag.id, { rot });
    }
  };

  const onPointerUp = () => {
    if (drag?.mode === "marquee") {
      const x1 = Math.min(drag.start.x, drag.current.x);
      const y1 = Math.min(drag.start.y, drag.current.y);
      const x2 = Math.max(drag.start.x, drag.current.x);
      const y2 = Math.max(drag.start.y, drag.current.y);
      // Minik jest (tık) → seçim değişikliği yok (pointerdown zaten temizledi).
      if (x2 - x1 > 0.5 || y2 - y1 > 0.5) {
        const hit = state.elements
          .filter((el) => {
            const b = estimateBounds(el, canvas);
            return b.x < x2 && x1 < b.x + b.w && b.y < y2 && y1 < b.y + b.h;
          })
          .map((el) => el.id);
        if (hit.length > 0) state.selectMany(hit, { additive: drag.additive });
      }
    }
    setDrag(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      state.selectMany(state.elements.map((el) => el.id));
      return;
    }
    if (e.key === "Escape") {
      state.select(null);
      return;
    }
    if (state.selectedIds.length === 0) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      state.removeSelected();
      return;
    }
    const step = e.shiftKey ? 2 : 0.5;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const d = nudge[e.key];
    if (d) {
      e.preventDefault();
      const patches: Record<string, Partial<LabelElement>> = {};
      for (const el of state.elements) {
        if (!state.selectedIds.includes(el.id)) continue;
        patches[el.id] = {
          x: clamp(snap(el.x + d[0]), 0, canvas.widthMm - 1),
          y: clamp(snap(el.y + d[1]), 0, canvas.heightMm - 1),
        } as Partial<LabelElement>;
      }
      state.applyPatches(patches);
    }
  };

  const marqueeRect =
    drag?.mode === "marquee"
      ? {
          left: Math.min(drag.start.x, drag.current.x) * zoom,
          top: Math.min(drag.start.y, drag.current.y) * zoom,
          width: Math.abs(drag.current.x - drag.start.x) * zoom,
          height: Math.abs(drag.current.y - drag.start.y) * zoom,
        }
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          Tuval: <strong>{canvas.widthMm}×{canvas.heightMm} mm</strong> · 0.5mm ızgara ·
          Ctrl+tık çoklu seç · boş alandan sürükle=çerçeve · Ctrl+A tümü
        </div>
        <div className="flex items-center gap-1">
          <AlignmentToolbar
            count={state.selectedIds.length}
            onAlign={(m: AlignMode) => state.applyPatches(alignElements(state.elements, state.selectedIds, m, canvas))}
            onDistribute={(m: DistributeMode) =>
              state.applyPatches(distributeElements(state.elements, state.selectedIds, m, canvas))
            }
          />
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!state.canUndo}
            onClick={state.undo} title="Geri al (tek adım)">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => onZoom(Math.max(MIN_ZOOM, zoom - 1))} title="Uzaklaş">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="w-10 text-center font-mono text-[11px]">{zoom}x</span>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => onZoom(Math.min(MAX_ZOOM, zoom + 1))} title="Yakınlaş">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-md border bg-muted/30 p-4">
        <div
          ref={stageRef}
          tabIndex={0}
          role="application"
          aria-label="Etiket tuvali"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={onStagePointerDown}
          onKeyDown={onKeyDown}
          className="relative mx-auto bg-white text-black shadow-md outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary/50 dark:bg-white"
          style={{
            width: canvas.widthMm * zoom,
            height: canvas.heightMm * zoom,
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0 1px, transparent 1px 100%)," +
              "repeating-linear-gradient(90deg, rgba(0,0,0,0.05) 0 1px, transparent 1px 100%)",
            backgroundSize: `${5 * zoom}px ${5 * zoom}px`,
          }}
        >
          {state.elements.map((el) => (
            <CanvasElementView
              key={el.id}
              element={el}
              canvas={canvas}
              zoom={zoom}
              selected={state.selectedIds.includes(el.id)}
              showHandles={state.selectedIds.length === 1 && state.selectedIds[0] === el.id}
              hasLintWarn={warnIds.has(el.id)}
              onPointerDown={onElementPointerDown}
              onHandlePointerDown={onHandlePointerDown}
            />
          ))}
          {marqueeRect && (
            <div
              className="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
              style={marqueeRect}
            />
          )}
          {state.elements.length === 0 && (
            <div className="flex h-full items-center justify-center text-xs italic text-black/40">
              Soldaki paletten eleman ekleyin
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
