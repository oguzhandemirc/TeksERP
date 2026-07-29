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
import { ZoomIn, ZoomOut, Undo2, Redo2, Magnet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CanvasPad, LabelElement } from "@/types/label-canvas";
import {
  applyResize,
  clamp,
  estimateBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  snap,
  snapRotation,
} from "./canvas-model";
import {
  alignElements,
  distributeElements,
  scaleElements,
  type AlignMode,
  type DistributeMode,
} from "./canvas-align";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { computeSnap } from "./canvas-snap";
import { CanvasElementView, type HandleMode } from "./CanvasElementView";
import { AlignmentToolbar } from "./AlignmentToolbar";
import type { EditorState } from "./useEditorState";
import type { LintIssue } from "./useCanvasLint";

interface Props {
  canvas: { widthMm: number; heightMm: number; pad?: CanvasPad };
  state: EditorState;
  zoom: number;
  onZoom: (z: number) => void;
  lint: LintIssue[];
  /** Kenar boşluğu (padding) değişince — verilirse padding kontrolü + güvenli-alan çizilir. */
  onPadChange?: (pad: CanvasPad) => void;
}

type DragState =
  | { mode: "move"; ids: string[]; startCursor: { x: number; y: number }; startPos: Record<string, { x: number; y: number }> }
  | { mode: HandleMode; id: string }
  | { mode: "marquee"; additive: boolean; start: { x: number; y: number }; current: { x: number; y: number } };

export function CanvasStage({ canvas, state, zoom, onZoom, lint, onPadChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Sürükleme sırasında beliren hizalama kılavuzları (mm) — pointerUp'ta temizlenir.
  const [guides, setGuides] = useState<{ vGuides: number[]; hGuides: number[] }>({ vGuides: [], hGuides: [] });
  // Akıllı hizalama (snap) açık mı — kapalıyken serbest 0.5mm ızgara sürüklemesi.
  const [snapOn, setSnapOn] = useState(true);
  const warnIds = new Set(lint.filter((i) => i.level !== "info" && i.elementId).map((i) => i.elementId));

  // Güvenli alan = tuval − padding. Eleman ORİJİNİ bu banda clamp'lenir (en az 1mm iç
  // alan). Padding yoksa eski davranış (0..boyut-1). Draw + sürükle/ok clamp'i paylaşır.
  const pd = canvas.pad ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const hasPad = !!(pd.top || pd.right || pd.bottom || pd.left);
  const clampX = (x: number) => clamp(x, pd.left, Math.max(pd.left, canvas.widthMm - pd.right - 1));
  const clampY = (y: number) => clamp(y, pd.top, Math.max(pd.top, canvas.heightMm - pd.bottom - 1));
  const setPadSide = (side: keyof CanvasPad, val: number) => {
    const max = side === "left" || side === "right" ? canvas.widthMm - 5 : canvas.heightMm - 5;
    onPadChange?.({ ...pd, [side]: Math.max(0, Math.min(Math.max(0, max), val || 0)) });
  };

  const mmFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  };

  const onElementPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return; // yalnız SOL tık sürükler (sağ tık = bağlam menüsü)
    e.stopPropagation();
    stageRef.current?.focus();
    // Ctrl/Cmd+tık: üyelik toggle (gruplu olsa da TEK eleman) — bir grup üyesini
    // ayrı düzenlemenin kaçış yolu. Sürükleme başlatmaz.
    if (e.ctrlKey || e.metaKey) {
      state.select(id, { toggle: true });
      return;
    }
    // Gruplu elemana tık → TÜM grup seçilir (birlikte taşınır); değilse tekli.
    const clicked = state.elements.find((x) => x.id === id);
    const groupMembers = clicked?.groupId
      ? state.elements.filter((x) => x.groupId === clicked.groupId).map((x) => x.id)
      : [id];
    // Zaten seçili bir elemana basıldıysa mevcut seçim (grup/çoklu) taşınır; değilse
    // tıklananın grubu (ya da tek eleman) seçilir.
    const alreadySel = state.selectedIds.includes(id);
    const ids = alreadySel ? state.selectedIds : groupMembers;
    if (!alreadySel) {
      if (groupMembers.length > 1) state.selectMany(groupMembers);
      else state.select(id);
    }
    // Kilitli üyeler sürüklemede yerinde kalır (grup/çoklu seçimde bile oynatılmaz).
    const dragIds = ids.filter((i) => !state.elements.find((el) => el.id === i)?.locked);
    state.snapshot(); // jest başı undo noktası
    const at = mmFromEvent(e);
    const startPos: Record<string, { x: number; y: number }> = {};
    for (const el of state.elements) if (dragIds.includes(el.id)) startPos[el.id] = { x: el.x, y: el.y };
    setDrag({ mode: "move", ids: dragIds, startCursor: at, startPos });
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
    if (e.button !== 0) return; // sağ tık marquee başlatmaz
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
      let dx = at.x - drag.startCursor.x;
      let dy = at.y - drag.startCursor.y;
      // Sürüklenen kümenin ham (snap öncesi) ortak sınır kutusu.
      let bx = Infinity, by = Infinity, br = -Infinity, bb = -Infinity;
      for (const id of drag.ids) {
        const start = drag.startPos[id];
        const el = state.elements.find((e) => e.id === id);
        if (!start || !el) continue;
        const eb = estimateBounds(el, canvas);
        bx = Math.min(bx, start.x + dx); by = Math.min(by, start.y + dy);
        br = Math.max(br, start.x + dx + eb.w); bb = Math.max(bb, start.y + dy + eb.h);
      }
      let gx = false, gy = false;
      if (snapOn && bx !== Infinity) {
        const dragSet = new Set(drag.ids);
        const others = state.elements.filter((e) => !dragSet.has(e.id)).map((e) => estimateBounds(e, canvas));
        const sr = computeSnap({ x: bx, y: by, w: br - bx, h: bb - by }, others, canvas);
        dx += sr.dx; dy += sr.dy;
        gx = sr.vGuides.length > 0; gy = sr.hGuides.length > 0;
        setGuides({ vGuides: sr.vGuides, hGuides: sr.hGuides });
      }
      const q = (v: number) => Math.round(v * 100) / 100; // snap yakalandıysa ızgaraya yuvarlama YOK
      for (const id of drag.ids) {
        const start = drag.startPos[id];
        if (!start) continue;
        state.updateElementLive(id, {
          x: clampX(gx ? q(start.x + dx) : snap(start.x + dx)),
          y: clampY(gy ? q(start.y + dy) : snap(start.y + dy)),
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
    if (el.type === "field" || el.type === "text" || el.type === "icon") {
      // icon: kare — 90°'de w/h takası gerekmez, yalnız rot yazılır.
      if (rot !== (el.rot ?? 0)) state.updateElementLive(drag.id, { rot });
    } else if (el.type === "lengthBanner") {
      const prev = el.rot ?? 90;
      if (rot !== prev) {
        // Şerit RİJİT döner: dik(90/270) ↔ yatay(0/180) geçişte kutu w/h TAKAS edilir.
        // Backend bannerGeom uzun ekseni metne / kısa ekseni glife verir — kutu şekli
        // dönüşe eşlik etmezse sadece iç yazı döner, şerit dönmez. Takas ile "yazı değil
        // şeridin kendisi de döner" (kullanıcı isteği). İlk takasta mm'ler explicit olur.
        const wasVertical = prev === 90 || prev === 270;
        const nowVertical = rot === 90 || rot === 270;
        if (wasVertical !== nowVertical) {
          const cur = estimateBounds(el, canvas);
          state.updateElementLive(drag.id, { rot, wMm: cur.h, hMm: cur.w });
        } else {
          state.updateElementLive(drag.id, { rot });
        }
      }
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
            if (el.locked) return false; // kilitli marquee ile seçilmez
            const b = estimateBounds(el, canvas);
            return b.x < x2 && x1 < b.x + b.w && b.y < y2 && y1 < b.y + b.h;
          })
          .map((el) => el.id);
        if (hit.length > 0) state.selectMany(hit, { additive: drag.additive });
      }
    }
    setDrag(null);
    setGuides({ vGuides: [], hGuides: [] }); // sürükleme bitti → kılavuzları temizle
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      state.selectMany(state.elements.map((el) => el.id));
      return;
    }
    // Geri al / yinele — çok adımlı (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y).
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) state.redo();
      else state.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      state.redo();
      return;
    }
    // Kopyala / yapıştır — seçili elemanları pano üzerinden çoğalt.
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      state.copySelected();
      return;
    }
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      state.paste();
      return;
    }
    // Grupla / grubu çöz.
    if (mod && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (e.shiftKey) state.ungroupSelected();
      else state.groupSelected();
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
        if (!state.selectedIds.includes(el.id) || el.locked) continue; // kilitli it'lenmez
        patches[el.id] = {
          x: clampX(snap(el.x + d[0])),
          y: clampY(snap(el.y + d[1])),
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
          Tuval: <strong>{canvas.widthMm}×{canvas.heightMm} mm</strong> · Ctrl+tık çoklu seç ·
          Ctrl+A tümü · Ctrl+Z/Y geri-yinele · Ctrl+C/V kopyala · Ctrl+G grupla
        </div>
        <div className="flex items-center gap-1">
          <AlignmentToolbar
            count={state.selectedIds.length}
            hasGroup={state.elements.some((e) => state.selectedIds.includes(e.id) && !!e.groupId)}
            onAlign={(m: AlignMode) => state.applyPatches(alignElements(state.elements, state.selectedIds, m, canvas))}
            onDistribute={(m: DistributeMode) =>
              state.applyPatches(distributeElements(state.elements, state.selectedIds, m, canvas))
            }
            onGroup={state.groupSelected}
            onUngroup={state.ungroupSelected}
            onScale={(f: number) => state.applyPatches(scaleElements(state.elements, state.selectedIds, f, canvas))}
          />
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!state.canUndo}
            onClick={state.undo} title="Geri al (Ctrl+Z)">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!state.canRedo}
            onClick={state.redo} title="Yinele (Ctrl+Y)">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant={snapOn ? "secondary" : "ghost"} className="h-7 w-7"
            onClick={() => setSnapOn((s) => !s)} title={snapOn ? "Akıllı hizalama AÇIK (kapat)" : "Akıllı hizalama KAPALI (aç)"}>
            <Magnet className="h-3.5 w-3.5" />
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

      {onPadChange && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium">Kenar boşluğu (mm):</span>
          {([["top", "Üst"], ["right", "Sağ"], ["bottom", "Alt"], ["left", "Sol"]] as [keyof CanvasPad, string][]).map(
            ([side, lbl]) => (
              <label key={side} className="flex items-center gap-1">
                <span className="text-[10px]">{lbl}</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={pd[side]}
                  onChange={(e) => setPadSide(side, Number(e.target.value))}
                  className="h-6 w-14 px-1.5 text-[11px]"
                />
              </label>
            ),
          )}
          {hasPad && (
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => onPadChange({ top: 0, right: 0, bottom: 0, left: 0 })}
            >
              sıfırla
            </button>
          )}
          <span className="text-[10px] italic">Elemanlar bu alana sıkışır; kesikli mavi çizgi kılavuzdur.</span>
        </div>
      )}

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
          {hasPad && (
            <div
              className="pointer-events-none absolute border border-dashed border-sky-500/70"
              style={{
                left: pd.left * zoom,
                top: pd.top * zoom,
                width: Math.max(0, canvas.widthMm - pd.left - pd.right) * zoom,
                height: Math.max(0, canvas.heightMm - pd.top - pd.bottom) * zoom,
              }}
            />
          )}
          {state.elements.map((el) => (
            <ContextMenu key={el.id}>
              <ContextMenuTrigger onContextMenu={() => { if (!state.selectedIds.includes(el.id)) state.select(el.id); }}>
                <CanvasElementView
                  element={el}
                  canvas={canvas}
                  zoom={zoom}
                  selected={state.selectedIds.includes(el.id)}
                  showHandles={state.selectedIds.length === 1 && state.selectedIds[0] === el.id}
                  hasLintWarn={warnIds.has(el.id)}
                  onPointerDown={onElementPointerDown}
                  onHandlePointerDown={onHandlePointerDown}
                />
              </ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                <ContextMenuItem onClick={() => state.duplicateElement(el.id)}>Çoğalt</ContextMenuItem>
                <ContextMenuItem onClick={() => state.bringToFront([el.id])}>En üste getir</ContextMenuItem>
                <ContextMenuItem onClick={() => state.sendToBack([el.id])}>En alta gönder</ContextMenuItem>
                <ContextMenuItem onClick={() => state.updateElement(el.id, { locked: !el.locked })}>
                  {el.locked ? "Kilidi aç" : "Kilitle"}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem className="text-destructive" onClick={() => state.removeElement(el.id)}>Sil</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {marqueeRect && (
            <div
              className="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
              style={marqueeRect}
            />
          )}
          {/* Akıllı hizalama kılavuzları (sürükleme sırasında) — pembe çizgiler. */}
          {guides.vGuides.map((vx, i) => (
            <div key={`v${i}`} className="pointer-events-none absolute top-0 bg-pink-500"
              style={{ left: vx * zoom, width: 1, height: canvas.heightMm * zoom }} />
          ))}
          {guides.hGuides.map((hy, i) => (
            <div key={`h${i}`} className="pointer-events-none absolute left-0 bg-pink-500"
              style={{ top: hy * zoom, height: 1, width: canvas.widthMm * zoom }} />
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
