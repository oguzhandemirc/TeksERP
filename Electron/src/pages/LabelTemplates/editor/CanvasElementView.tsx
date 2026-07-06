// =============================================================================
// Etiket Stüdyosu — kanvas eleman görseli (yaklaşık; gerçek WYSIWYG backend'te)
// =============================================================================

import { QrCode, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LabelElement } from "@/types/label-canvas";
import { skippedLanguages } from "@/types/label-canvas";
import { estimateBounds, FONT_MM } from "./canvas-model";

interface Props {
  element: LabelElement;
  canvas: { widthMm: number; heightMm: number };
  zoom: number;
  selected: boolean;
  hasLintWarn: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

export function CanvasElementView({ element: el, canvas, zoom, selected, hasLintWarn, onPointerDown }: Props) {
  const b = estimateBounds(el, canvas);
  const style: React.CSSProperties = {
    position: "absolute",
    left: b.x * zoom,
    top: b.y * zoom,
    width: Math.max(4, b.w * zoom),
    height: Math.max(3, b.h * zoom),
  };
  const skipped = skippedLanguages(el.type);

  return (
    <div
      style={style}
      onPointerDown={(e) => onPointerDown(e, el.id)}
      className={cn(
        "group cursor-grab select-none touch-none",
        selected && "z-10",
      )}
      title={`${el.id} — ${Math.round(b.x * 10) / 10}, ${Math.round(b.y * 10) / 10} mm`}
    >
      <div
        className={cn(
          "h-full w-full overflow-hidden rounded-[1px] border",
          selected
            ? "border-primary ring-2 ring-primary/40"
            : "border-transparent group-hover:border-primary/40",
        )}
      >
        <ElementBody el={el} zoom={zoom} />
      </div>
      {(skipped.length > 0 || hasLintWarn) && (
        <span
          className={cn(
            "absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px]",
            hasLintWarn ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground border",
          )}
          title={
            hasLintWarn
              ? "Lint uyarısı var (taşma/çakışma) — sağ paneldeki listeye bak"
              : `${skipped.join(", ")} dilinde basılmaz`
          }
        >
          {hasLintWarn ? <AlertTriangle className="h-2.5 w-2.5" /> : "!"}
        </span>
      )}
    </div>
  );
}

function ElementBody({ el, zoom }: { el: LabelElement; zoom: number }) {
  switch (el.type) {
    case "field":
    case "text": {
      const font = FONT_MM[el.font ?? "md"];
      const mul = el.bold ? 2 : 1;
      const text = el.type === "text" ? el.text : `${el.label?.trim() ? `${el.label}: ` : ""}‹${el.bind}›`;
      const rot = el.rot ?? 0;
      return (
        <div
          className={cn("whitespace-nowrap font-mono leading-none text-foreground", el.bold && "font-bold")}
          style={{
            fontSize: Math.max(7, font.h * mul * zoom * 0.85),
            transform: rot ? `rotate(${rot}deg)` : undefined,
            transformOrigin: "top left",
          }}
        >
          {text}
        </div>
      );
    }
    case "qr":
      return (
        <div className="flex h-full w-full items-center justify-center border border-dashed border-foreground/40 bg-muted/40">
          <QrCode className="h-2/3 w-2/3 text-foreground/60" />
        </div>
      );
    case "code128":
      return (
        <div className="flex h-full w-full flex-col">
          <div
            className="flex-1"
            style={{
              background:
                "repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 4px, currentColor 4px 5px, transparent 5px 8px)",
            }}
          />
          {el.human !== false && (
            <div className="text-center font-mono text-[7px] tracking-widest text-muted-foreground">BARKOD</div>
          )}
        </div>
      );
    case "line":
      return <div className="h-full w-full bg-foreground" />;
    case "box":
      return (
        <div
          className="h-full w-full"
          style={{ border: `${Math.max(1, (el.thickMm ?? 0.5) * zoom)}px solid currentColor` }}
        />
      );
    case "lengthBanner":
      return (
        <div className="flex h-full w-full items-center justify-center bg-foreground text-background">
          <span className="rotate-90 whitespace-nowrap font-mono text-[8px] font-bold">METRAJ</span>
        </div>
      );
  }
}
