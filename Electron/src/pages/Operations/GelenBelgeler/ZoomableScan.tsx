// Yakınlaştırılabilir tarama: görüntü + vurgu kutusu TEK dönüşüm kabında (zoom/kaydırma/döndürme birlikte).
// Sayfa değişiminde üst bileşen `key` verir → görünüm kendiliğinden sığdır'a döner.
import { useRef } from "react";
import { useScanGestures } from "./useScanGestures";
import { useZoomView } from "./useZoomView";
import { ScanZoomToolbar } from "./ScanZoomToolbar";
import { fromScreen, rotatedSize, viewMatrix, type Box, type Pt, type Size } from "./scanView";

/** Tanıtma ekranı (S1b) kutusu: görüntü pikselinde; `tone` rengi seçer, `label` küçük künye. */
export interface ScanMark {
  key: string;
  box: Box;
  tone: "word" | "selected" | "field" | "column" | "section";
  label?: string;
}
const MARK_TONE: Record<ScanMark["tone"], string> = {
  word: "border-sky-500/50 bg-transparent",
  selected: "border-amber-500 bg-amber-400/30",
  field: "border-emerald-600 bg-emerald-400/25",
  column: "border-violet-600 bg-violet-400/25",
  section: "border-rose-600 bg-rose-400/20",
};

interface Props {
  url: string;
  alt: string;
  /** Görüntü pikseli cinsinden vurgu kutusu; null = çizilmez. */
  highlight: Box | null;
  /** Seçili satır değişince (yakınlaşılmışsa) kutu görünüme kaydırılır. */
  selectionKey?: string | null;
  /** Ek kutular (tanıtma: kelimeler, atanmış alanlar); görüntüyle birlikte dönüşür. */
  marks?: readonly ScanMark[];
  /** Kısa tık/dokunma (kaydırma değil) — görüntü pikseli cinsinden nokta. */
  onTap?: (at: Pt) => void;
  /** Kutuların çerçevesi (K28 KÜÇÜK fotoğraf: okuma çerçevesi ≠ bayt pikseli); verilirse görüntü bu boyuta gerilir. */
  frame?: Size | null;
}

const pct = (r: Box, nat: Size) => ({
  left: `${(r.x / nat.w) * 100}%`,
  top: `${(r.y / nat.h) * 100}%`,
  width: `${(r.width / nat.w) * 100}%`,
  height: `${(r.height / nat.h) * 100}%`,
});

export function ZoomableScan({ url, alt, highlight, selectionKey = null, marks, onTap, frame = null }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const z = useZoomView(ref, highlight, selectionKey);
  const { nat, view: v, vp } = z;
  const tap = onTap && nat && v ? (at: Pt) => onTap(fromScreen(v, nat, at)) : undefined;
  const gestures = useScanGestures(ref, nat, vp, { update: z.update, onTap: tap });
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
            style={nat ? { width: nat.w, height: nat.h } : undefined}
            onLoad={(e) => z.setNat(frame ?? { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {nat &&
            marks?.map((m) => (
              <div
                key={m.key}
                className={`pointer-events-none absolute rounded-sm border-solid ${MARK_TONE[m.tone]}`}
                style={{ ...pct(m.box, nat), borderWidth: `${(m.tone === "word" ? 1 : 2) / (v?.scale || 1)}px` }}
                data-testid={`scan-mark-${m.tone}`}
                title={m.label}
              />
            ))}
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
