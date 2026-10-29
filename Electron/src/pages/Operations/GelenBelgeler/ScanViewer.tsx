// Belge fotoğrafı + seçili satırın kaynak kutusu (yüzde konumlu kaplama; görüntü genişliğe sığar).
// Rect sayfa taşımaz (motor tek görüntü koordinatı yazar) → vurgu seçili sayfanın üstüne çizilir.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useScanImage } from "./useScanImage";
import type { DocumentScanInfo, OcrRect } from "./types";

interface Props {
  scans: DocumentScanInfo[];
  highlight: OcrRect | null;
}

export function ScanViewer({ scans, highlight }: Props) {
  const [idx, setIdx] = useState(0);
  const scan = scans[Math.min(idx, scans.length - 1)] ?? null;
  const img = useScanImage(scan?.id ?? null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  if (!scan) return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Bu taslağın fotoğrafı yok (elle ya da Excel'den açıldı).</div>;
  const pct = (r: OcrRect) => (nat ? { left: `${(r.x / nat.w) * 100}%`, top: `${(r.y / nat.h) * 100}%`, width: `${(r.width / nat.w) * 100}%`, height: `${(r.height / nat.h) * 100}%` } : undefined);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {scans.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {scans.map((s, i) => (
            <Button key={s.id} size="sm" variant={i === idx ? "default" : "outline"} onClick={() => setIdx(i)}>
              Sayfa {s.pageNo}
              {s.regionNo ? `/${s.regionNo}` : ""}
            </Button>
          ))}
        </div>
      )}
      {img.isLoading && <div className="text-sm text-muted-foreground">Fotoğraf yükleniyor…</div>}
      {img.isError && <div className="text-sm text-destructive">Fotoğraf alınamadı.</div>}
      {img.url && img.isPdf && (
        <a className="text-sm underline" href={img.url} target="_blank" rel="noreferrer">
          PDF belgeyi aç
        </a>
      )}
      {img.url && !img.isPdf && (
        <div className="relative w-full overflow-hidden rounded border" data-testid="scan-viewer">
          <img src={img.url} alt={`Belge sayfa ${scan.pageNo}`} className="block h-auto w-full" onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {highlight && nat && <div className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-400/20" style={pct(highlight)} data-testid="scan-highlight" />}
        </div>
      )}
    </div>
  );
}
