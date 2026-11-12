// Etiket önizlemesi + yakınlaştırma (−/+, yüzde, Sığdır, %100 gerçek boyut, Ctrl/⌘+tekerlek,
// büyükken sürükle-kaydır). Paket yok: iframe doğal boyutunda çizilir, CSS transform ile ölçeklenir.
// Etiket HTML'i mm/px birimli olduğundan ölçek 1 = 96 dpi'da gerçek boyut.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const STEP = 1.25;
// Ölçülemeyen içerik (jsdom, boş belge) için güvenli doğal boyut.
const FALLBACK = { w: 480, h: 320 };

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

interface Props {
  content: string;
  title?: string;
  /** Görüntü alanı yüksekliği (Tailwind sınıfı). */
  heightClass?: string;
}

/** Yakınlaştırma + sürükle-kaydır durumu; görüntü alanı ve iframe ref'lerini çağırana verir. */
function useZoomPan() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [natural, setNatural] = useState(FALLBACK);
  const [zoom, setZoom] = useState(1);
  // Kullanıcı elle yakınlaştırmadıkça yeni içerik geldiğinde sığdırılır.
  const autoFit = useRef(true);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fitZoom = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || vp.clientWidth === 0 || vp.clientHeight === 0) return 1;
    return clampZoom(Math.min((vp.clientWidth - 16) / natural.w, (vp.clientHeight - 16) / natural.h));
  }, [natural]);

  const setManual = (z: number) => {
    autoFit.current = false;
    setZoom(clampZoom(z));
  };
  const fit = () => {
    autoFit.current = true;
    setZoom(fitZoom());
  };

  const measure = () => {
    const doc = frameRef.current?.contentDocument;
    const el = doc?.documentElement;
    const w = el ? Math.max(el.scrollWidth, doc?.body?.scrollWidth ?? 0) : 0;
    const h = el ? Math.max(el.scrollHeight, doc?.body?.scrollHeight ?? 0) : 0;
    setNatural(w > 0 && h > 0 ? { w, h } : FALLBACK);
  };

  useLayoutEffect(() => {
    if (autoFit.current) setZoom(fitZoom());
  }, [fitZoom]);

  // Ctrl/⌘ + tekerlek — passive:false gerekir (preventDefault sayfa yakınlaştırmasını durdurur).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      autoFit.current = false;
      setZoom((z) => clampZoom(e.deltaY < 0 ? z * 1.1 : z / 1.1));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = viewportRef.current;
    if (!vp || (vp.scrollWidth <= vp.clientWidth && vp.scrollHeight <= vp.clientHeight)) return;
    drag.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop };
    setDragging(true);
    vp.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = viewportRef.current;
    const d = drag.current;
    if (!vp || !d) return;
    vp.scrollLeft = d.left - (e.clientX - d.x);
    vp.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return {
    viewportRef, frameRef, natural, zoom, dragging, setManual, fit, measure,
    pointer: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}

export function LabelPreviewZoom({ content, title = "Etiket önizlemesi", heightClass = "h-[560px]" }: Props) {
  const { viewportRef, frameRef, natural, zoom, dragging, setManual, fit, measure, pointer } = useZoomPan();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1" role="toolbar" aria-label="Yakınlaştırma">
        <Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label="Uzaklaştır" onClick={() => setManual(zoom / STEP)} disabled={zoom <= MIN_ZOOM}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-14 text-center text-xs tabular-nums" data-testid="zoom-percent">
          %{Math.round(zoom * 100)}
        </span>
        <Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label="Yakınlaştır" onClick={() => setManual(zoom * STEP)} disabled={zoom >= MAX_ZOOM}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={fit}>
          <Maximize2 className="h-3.5 w-3.5" /> Sığdır
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setManual(1)} title="Etiketin basılacağı gerçek boyut">
          %100 (gerçek boyut)
        </Button>
        <span className="ml-auto hidden text-[10px] text-muted-foreground sm:inline">Ctrl/⌘ + tekerlek ile yakınlaştır</span>
      </div>
      <div
        ref={viewportRef}
        data-testid="zoom-viewport"
        className={`${heightClass} w-full overflow-auto rounded border bg-muted/30 p-2 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        {...pointer}
      >
        <div className="mx-auto" style={{ width: natural.w * zoom, height: natural.h * zoom }}>
          <iframe
            ref={frameRef}
            title={title}
            srcDoc={content}
            sandbox="allow-same-origin allow-modals"
            onLoad={measure}
            // pointer-events yok: tekerlek/sürükleme iframe belgesine kaçmasın (önizleme etkileşimsiz).
            className="pointer-events-none origin-top-left border-0 bg-white"
            style={{ width: natural.w, height: natural.h, transform: `scale(${zoom})` }}
          />
        </div>
      </div>
    </div>
  );
}
