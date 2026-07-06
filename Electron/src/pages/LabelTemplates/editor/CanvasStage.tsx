// =============================================================================
// Etiket Stüdyosu — kanvas sahnesi (mm tuval + zoom + sürükle + klavye)
// =============================================================================
// Sürükleme saf pointer-event'le (ek bağımlılık yok; dnd-kit liste sıralamada
// kalmaya devam eder): pointerdown seç + yakala, pointermove 0.5mm snap ile
// taşı, Delete sil, ok tuşları 0.5mm (Shift=2mm) it. Görsel YAKLAŞIKTIR —
// gerçek çıktı sağdaki backend önizlemesinde.

import { useRef, useState } from "react";
import { ZoomIn, ZoomOut, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LabelElement } from "@/types/label-canvas";
import { applyResize, clamp, estimateBounds, MAX_ZOOM, MIN_ZOOM, snap, snapRotation } from "./canvas-model";
import { CanvasElementView, type HandleMode } from "./CanvasElementView";
import type { EditorState } from "./useEditorState";
import type { LintIssue } from "./useCanvasLint";

interface Props {
  canvas: { widthMm: number; heightMm: number };
  state: EditorState;
  zoom: number;
  onZoom: (z: number) => void;
  lint: LintIssue[];
}

export function CanvasStage({ canvas, state, zoom, onZoom, lint }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<
    { mode: "move" | HandleMode; id: string; offMmX: number; offMmY: number } | null
  >(null);
  const warnIds = new Set(lint.filter((i) => i.level !== "info" && i.elementId).map((i) => i.elementId));

  const mmFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  };

  const onElementPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const el = state.elements.find((x) => x.id === id);
    if (!el) return;
    state.select(id);
    // Sürükleme başlangıcında undo noktası (no-op commit — snapshot alır).
    state.updateElement(id, {});
    const at = mmFromEvent(e);
    setDrag({ mode: "move", id, offMmX: at.x - el.x, offMmY: at.y - el.y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  // Köşe (boyutlandır) / döndür tutamacı — sürüklemeyi sahne yürütür.
  const onHandlePointerDown = (e: React.PointerEvent, id: string, mode: HandleMode) => {
    e.stopPropagation();
    state.select(id);
    state.updateElement(id, {}); // undo noktası
    setDrag({ mode, id, offMmX: 0, offMmY: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const at = mmFromEvent(e);
    const el = state.elements.find((x) => x.id === drag.id);
    if (!el) return;

    if (drag.mode === "move") {
      state.moveElement(
        drag.id,
        clamp(at.x - drag.offMmX, 0, canvas.widthMm - 1),
        clamp(at.y - drag.offMmY, 0, canvas.heightMm - 1),
      );
      return;
    }
    if (drag.mode === "resize") {
      // Hedef kutu = elemanın sol-üstünden imlece; tip kendi "boyut" anlamına çevirir
      // (metin→font kademesi, QR→ölçek, barkod→bar yüksekliği — applyResize).
      const patch = applyResize(el, at.x - el.x, at.y - el.y);
      if (patch) state.updateElementLive(drag.id, patch);
      return;
    }
    // rotate: eleman merkezine göre imleç açısı → 90° adıma oturt (yazıcı sınırı).
    const b = estimateBounds(el, canvas);
    const cx = el.x + b.w / 2;
    const cy = el.y + b.h / 2;
    const deg = (Math.atan2(at.y - cy, at.x - cx) * 180) / Math.PI + 90; // tutamaç üstte
    const rot = snapRotation(deg);
    if ((el.type === "field" || el.type === "text") && rot !== (el.rot ?? 0)) {
      state.updateElementLive(drag.id, { rot });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const sel = state.selectedId ? state.elements.find((x) => x.id === state.selectedId) : null;
    if (!sel) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      state.removeElement(sel.id);
      return;
    }
    const step = e.shiftKey ? 2 : 0.5;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = nudge[e.key];
    if (d) {
      e.preventDefault();
      state.updateElement(sel.id, {
        x: clamp(snap(sel.x + d[0]), 0, canvas.widthMm - 1),
        y: clamp(snap(sel.y + d[1]), 0, canvas.heightMm - 1),
      } as Partial<LabelElement>);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          Tuval: <strong>{canvas.widthMm}×{canvas.heightMm} mm</strong> · ızgara 0.5mm ·
          sürükle / ok tuşları (Shift=2mm) / Delete
        </div>
        <div className="flex items-center gap-1">
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
          onPointerUp={() => setDrag(null)}
          onPointerDown={() => state.select(null)}
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
              selected={state.selectedId === el.id}
              hasLintWarn={warnIds.has(el.id)}
              onPointerDown={onElementPointerDown}
              onHandlePointerDown={onHandlePointerDown}
            />
          ))}
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
