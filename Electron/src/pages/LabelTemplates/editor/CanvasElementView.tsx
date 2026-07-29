// =============================================================================
// Etiket Stüdyosu — kanvas eleman görseli (yaklaşık; gerçek WYSIWYG backend'te)
// =============================================================================

import { QrCode, AlertTriangle, RotateCw, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IconElement, LabelElement } from "@/types/label-canvas";
import { skippedLanguages } from "@/types/label-canvas";
import { estimateBounds, FONT_MM } from "./canvas-model";
import { useIconCatalog } from "./useIconCatalog";

export type HandleMode = "resize" | "rotate";

interface Props {
  element: LabelElement;
  canvas: { widthMm: number; heightMm: number };
  zoom: number;
  selected: boolean;
  /** Tutamaçlar yalnız TEKLİ seçimde gösterilir (çoklu seçimde grup taşınır). */
  showHandles: boolean;
  hasLintWarn: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  /** Seçili elemanın köşe/döndürme tutamacı basımı — CanvasStage sürüklemeyi yürütür. */
  onHandlePointerDown: (e: React.PointerEvent, id: string, mode: HandleMode) => void;
}

export function CanvasElementView({ element: el, canvas, zoom, selected, showHandles, hasLintWarn, onPointerDown, onHandlePointerDown }: Props) {
  const b = estimateBounds(el, canvas);
  const style: React.CSSProperties = {
    position: "absolute",
    left: b.x * zoom,
    top: b.y * zoom,
    width: Math.max(4, b.w * zoom),
    height: Math.max(3, b.h * zoom),
    // Kilitli → tıklama geçirmez (altındaki eleman seçilebilir; seçim katman listesinden).
    pointerEvents: el.locked ? "none" : undefined,
  };
  const skipped = skippedLanguages(el.type);

  return (
    <div
      style={style}
      onPointerDown={(e) => onPointerDown(e, el.id)}
      className={cn(
        "group select-none touch-none",
        el.locked ? "cursor-default" : "cursor-grab",
        selected && "z-10",
      )}
      title={`${el.id} — ${Math.round(b.x * 10) / 10}, ${Math.round(b.y * 10) / 10} mm${el.locked ? " (kilitli)" : ""}`}
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
      {el.locked && (
        <span className="absolute -left-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-background text-amber-600"
          title="Kilitli — katman listesinden aç">
          <Lock className="h-2 w-2" />
        </span>
      )}
      {showHandles && !el.locked && (
        <>
          {/* SE köşe: boyutlandırma. Metinde font kademesine (4'lü), QR'da ölçeğe
              (2-15), barkodda bar yüksekliğine oturur — serbest boyut yalnız
              çizgi/kutu/bantta (yazıcı gerçekleri). */}
          <span
            onPointerDown={(e) => onHandlePointerDown(e, el.id, "resize")}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-primary bg-background shadow"
            title={
              el.type === "field" || el.type === "text"
                ? "Sürükle → font kademesi (sm/md/lg/xl — yazıcı bitmap fontları serbest punto basmaz)"
                : el.type === "qr"
                  ? "Sürükle → QR ölçeği (2-15)"
                  : el.type === "code128"
                    ? "Sürükle → bar yüksekliği"
                    : el.type === "icon"
                      ? "Sürükle → sembol boyutu (3-50 mm, kare)"
                      : "Sürükle → boyutlandır"
            }
          />
          {(el.type === "field" || el.type === "text" || el.type === "lengthBanner" || el.type === "icon") && (
            <span
              onPointerDown={(e) => onHandlePointerDown(e, el.id, "rotate")}
              className="absolute -top-5 left-1/2 flex h-4 w-4 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-primary bg-background shadow"
              title="Sürükle → döndür (90° adımlarla oturur — PPLA/PPLB/ZPL yalnız 0/90/180/270 basar)"
            >
              <RotateCw className="h-2.5 w-2.5 text-primary" />
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Bakım sembolü — katalog SVG'si (currentColor). Tuval zemini beyaz olduğundan
 *  renk siyaha SABİTLENİR (uygulama teması karanlıkta da vuruş siyah kalır).
 *  Bilinmeyen/yüklenmemiş anahtar → kesikli kutu + anahtar metni. */
function IconBody({ el }: { el: IconElement }) {
  const { byKey, isLoading } = useIconCatalog();
  const info = byKey.get(el.icon);
  if (!info) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden border border-dashed border-foreground/40 bg-muted/40 p-0.5">
        <span className="truncate font-mono text-[8px] text-foreground/50">
          {isLoading ? "…" : el.icon}
        </span>
      </div>
    );
  }
  const rot = el.rot ?? 0;
  return (
    <div
      className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
      style={{ color: "#000", transform: rot ? `rotate(${rot}deg)` : undefined }}
      dangerouslySetInnerHTML={{ __html: info.svg }}
    />
  );
}

function ElementBody({ el, zoom }: { el: LabelElement; zoom: number }) {
  switch (el.type) {
    case "field":
    case "text": {
      // Serbest boyut (hMm) varsa birebir; yoksa eski 4-kademe eşleniği.
      const hMm = el.hMm ?? FONT_MM[el.font ?? "md"].h * (el.bold ? 2 : 1);
      const wr = el.hMm != null ? (el.wr ?? 1) : 1;
      const text = el.type === "text" ? el.text : `${el.label?.trim() ? `${el.label}: ` : ""}‹${el.bind}›`;
      const rot = el.rot ?? 0;
      const transforms: string[] = [];
      if (rot) transforms.push(`rotate(${rot}deg)`);
      if (wr !== 1) transforms.push(`scaleX(${wr})`);
      return (
        <div
          // Kalın: serbest boyutta gerçek vuruş kalınlığı (backend çift-vuruş/font-weight);
          // eski kademeli modda kalın zaten 2× boyuttan gelir (hMm hesabı), font-bold yok.
          // Sabit metin `whitespace-pre` → `\n` alt alta gösterilir (backend ile birebir).
          className={cn(
            "h-full w-full font-mono leading-tight text-foreground",
            el.type === "text" ? "whitespace-pre" : "whitespace-nowrap",
            el.hMm != null && el.bold && "font-bold",
          )}
          style={{
            fontSize: Math.max(7, hMm * zoom * 0.85),
            // Hizalama: çok satırda satırları birbirine hizalar (kutu estimateBounds ile çapaya kaydı).
            textAlign: (el.align ?? "left") as "left" | "center" | "right",
            // Harf dönüşümü (yaklaşık — backend WYSIWYG önizlemesi Türkçe-duyarlı tamı gösterir).
            textTransform: el.textCase === "upper" ? "uppercase" : el.textCase === "lower" ? "lowercase" : undefined,
            transform: transforms.length ? transforms.join(" ") : undefined,
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
            <div
              className="text-center font-mono tracking-widest text-muted-foreground"
              style={{
                fontSize: Math.max(6, (el.humanHMm ?? 2.5) * zoom * 0.75),
                transform:
                  el.humanDx || el.humanDy
                    ? `translate(${(el.humanDx ?? 0) * zoom}px, ${(el.humanDy ?? 0) * zoom}px)`
                    : undefined,
              }}
            >
              BARKOD
            </div>
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
    case "icon":
      return <IconBody el={el} />;
    case "lengthBanner": {
      // Yaklaşık: birim eki + serbest değer boyutu + genişlik oranı yansıtılır
      // (gerçek WYSIWYG backend önizlemesinde).
      const bTransforms = [`rotate(${el.rot ?? 90}deg)`];
      if ((el.wr ?? 1) !== 1) bTransforms.push(`scaleX(${el.wr ?? 1})`);
      return (
        <div className="flex h-full w-full items-center justify-center overflow-hidden bg-foreground text-background">
          <span
            className="whitespace-nowrap font-mono font-bold"
            style={{
              fontSize: el.glyphHMm != null ? Math.max(6, el.glyphHMm * zoom * 0.85) : 8,
              transform: bTransforms.join(" "),
            }}
          >
            {el.unit === false ? "METRAJ" : "METRAJ m"}
          </span>
        </div>
      );
    }
  }
}
