import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { rectFrom, type Point } from "./model";
import { drawScene, drawShape, type DrawContext } from "./render";
import type { Annotator } from "./useAnnotator";

interface Props {
  image: HTMLImageElement;
  annotator: Annotator;
}

/** Kırpma alanının dışını karartır ve çerçeve çizer (yalnız ekranda; çıktıda alan kesilir). */
function drawCropOverlay(ctx: CanvasRenderingContext2D, area: { x: number; y: number; w: number; h: number }) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, width, area.y);
  ctx.fillRect(0, area.y + area.h, width, height - area.y - area.h);
  ctx.fillRect(0, area.y, area.x, area.h);
  ctx.fillRect(area.x + area.w, area.y, width - area.x - area.w, area.h);
  ctx.strokeStyle = "#ffffff";
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}

function toImagePoint(e: ReactPointerEvent<HTMLCanvasElement>): Point {
  const el = e.currentTarget;
  const box = el.getBoundingClientRect();
  const sx = box.width > 0 ? el.width / box.width : 1;
  const sy = box.height > 0 ? el.height / box.height : 1;
  return { x: (e.clientX - box.left) * sx, y: (e.clientY - box.top) * sy };
}

export function AnnotateCanvas({ image, annotator }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { snapshot, draft, text, tool, pointer } = annotator;
  const dragging = useRef(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawScene(ctx as DrawContext, image, snapshot);
    if (draft && "shape" in draft) drawShape(ctx as DrawContext, draft.shape);
    const cropArea = draft && "crop" in draft ? rectFrom(draft.crop.from, draft.crop.to) : snapshot.crop;
    if (cropArea) drawCropOverlay(ctx, cropArea);
  }, [image, snapshot, draft]);

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (tool === "text") {
      // ⚠️ Tuvale tıklamanın varsayılan eylemi odağı GÖVDEYE taşır: yeni açılan etiket kutusu aynı
      // tıklamada blur olup boş değerle kapanıyordu (metin aracı "çalışmıyor" hatası). Varsayılan engellenir.
      e.preventDefault();
      dragging.current = false;
      pointer.down(toImagePoint(e));
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    pointer.down(toImagePoint(e));
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragging.current) pointer.move(toImagePoint(e));
  };
  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    pointer.up();
  };

  return (
    <div className="relative inline-block max-h-full max-w-full">
      <canvas
        ref={canvasRef}
        width={image.naturalWidth}
        height={image.naturalHeight}
        aria-label="Ekran görüntüsü çizim alanı"
        className="block max-h-[62vh] max-w-full touch-none rounded border border-border/60 bg-muted"
        style={{ cursor: tool === "text" ? "text" : "crosshair" }}
        onPointerDown={onDown}
        onMouseDown={(e) => tool === "text" && e.preventDefault()}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />
      {text && <TextOverlay annotator={annotator} canvas={canvasRef.current} />}
    </div>
  );
}

/** Metin etiketi girişi: tıklanan noktada küçük bir kutu; Enter işler, Esc vazgeçer. */
function TextOverlay({ annotator, canvas }: { annotator: Annotator; canvas: HTMLCanvasElement | null }) {
  const { text, setText, commitText, color } = annotator;
  const inputRef = useRef<HTMLInputElement>(null);
  // Odak bir kare sonra: açan tıklamanın kalan olayları odağı geri almasın.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  if (!text || !canvas) return null;
  const scale = canvas.clientWidth > 0 ? canvas.clientWidth / canvas.width : 1;
  return (
    <input
      ref={inputRef}
      autoFocus
      aria-label="Etiket metni"
      placeholder="Metin yazın, Enter"
      value={text.value}
      maxLength={120}
      onChange={(e) => setText({ at: text.at, value: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commitText();
        if (e.key === "Escape") setText(null);
      }}
      onBlur={commitText}
      className="absolute z-10 w-48 rounded border border-border bg-background/95 px-2 py-1 text-sm shadow"
      style={{ left: text.at.x * scale, top: text.at.y * scale, color }}
    />
  );
}
