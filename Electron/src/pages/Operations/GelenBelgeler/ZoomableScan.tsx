// Yakınlaştırılabilir tarama: görüntü + vurgu kutusu TEK dönüşüm kabında (zoom/kaydırma/döndürme birlikte).
// Sayfa değişiminde üst bileşen `key` verir → görünüm kendiliğinden sığdır'a döner.
import { useRef } from "react";
import { useScanGestures } from "./useScanGestures";
import { useZoomView } from "./useZoomView";
import { ScanZoomToolbar } from "./ScanZoomToolbar";
import { rotatedSize, viewMatrix, type Box, type Size } from "./scanView";

interface Props {
  url: string;
  alt: string;
  /** Görüntü pikseli cinsinden vurgu kutusu; null = çizilmez. */
  highlight: Box | null;
  /** Seçili satır değişince (yakınlaşılmışsa) kutu görünüme kaydırılır. */
  selectionKey?: string | null;
}

const pct = (r: Box, nat: Size) => ({
  left: `${(r.x / nat.w) * 100}%`,
  top: `${(r.y / nat.h) * 100}%`,
  width: `${(r.width / nat.w) * 100}%`,
  height: `${(r.height / nat.h) * 100}%`,
});

export function ZoomableScan({ url, alt, highlight, selectionKey = null }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const z = useZoomView(ref, highlight, selectionKey);
  const { nat, view: v, vp } = z;
  const gestures = useScanGestures(ref, nat, vp, z.update);
  const r = nat && v ? rotatedSize(nat, v.rot) : null;
  // Normal düzende görünüm döndürülmüş sayfanın oranını alır (en çok ekranın %75'i); büyük görünümde kalan alanı doldurur.
  const viewportStyle = z.full
    ? undefined
    : { aspectRatio: r ? `${r.w} / ${r.h}` : "3 / 4", maxHeight: "75vh" };
  return (
    <div
      className={z.full ? "fixed inset-0 z-50 flex flex-col bg-background p-4" : "relative"}
      data-testid="scan-zoom-root"
      data-fullscreen={z.full ? "true" : "false"}
    >
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label="Belge fotoğrafı — tekerlek/+/− yakınlaştırır, sürükleyerek kaydırılır, 0 sığdırır, R döndürür"
        className={`relative w-full cursor-grab touch-none select-none overflow-hidden rounded border bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing ${z.full ? "min-h-0 flex-1" : ""}`}
        style={viewportStyle}
        data-testid="scan-viewer"
        {...gestures}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            transformOrigin: "0 0",
            transform: nat && v ? `matrix(${viewMatrix(v, nat).join(",")})` : undefined,
            opacity: nat ? 1 : 0,
            width: nat?.w,
            height: nat?.h,
          }}
          data-testid="scan-transform"
        >
          <img
            src={url}
            alt={alt}
            draggable={false}
            className="block max-w-none"
            onLoad={(e) => z.setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {highlight && nat && (
            // Çerçeve kalınlığı ölçeğe bölünür: ekranda hep ~2px kalır.
            <div
              className="pointer-events-none absolute rounded-sm border-solid border-amber-500 bg-amber-400/20"
              style={{ ...pct(highlight, nat), borderWidth: `${2 / (v?.scale || 1)}px` }}
              data-testid="scan-highlight"
            />
          )}
        </div>
        {nat && v && (
          <ScanZoomToolbar
            view={v}
            geo={{ nat, vp }}
            highlight={highlight}
            full={z.full}
            onStep={z.update}
            onToggleFull={z.toggleFull}
          />
        )}
      </div>
    </div>
  );
}
