// Belge fotoğrafı + seçili satırın kaynak kutusu; yakınlaştırma/kaydırma/döndürme ZoomableScan'de (sayfa başına sıfırlanır).
// Satır kendi sayfasının taramasını taşıyorsa (E4 scanId) görüntü o sayfaya geçer ve vurgu yalnız orada çizilir;
// taşımıyorsa (elle satır/eski backend) bugünkü davranış: vurgu seçili sayfanın üstüne.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScanImage } from "./useScanImage";
import { ZoomableScan } from "./ZoomableScan";
import type { DocumentScanInfo, OcrRect } from "./types";

interface Props {
  scans: DocumentScanInfo[];
  highlight: OcrRect | null;
  /** Vurgunun ait olduğu tarama; null = bilinmiyor (seçili sayfaya çizilir). */
  highlightScanId?: string | null;
  /** Seçili satırın kimliği: aynı sayfadaki başka satır seçilince de (elle sayfa değişmişse) o sayfaya dönülür. */
  selectionKey?: string | null;
}

export function ScanViewer({ scans, highlight, highlightScanId = null, selectionKey = null }: Props) {
  const [idx, setIdx] = useState(0);
  // Belgede olmayan tarama kimliği bilinmiyor sayılır (vurgu kaybolmaz, seçili sayfaya çizilir).
  const ownScanId = highlightScanId && scans.some((s) => s.id === highlightScanId) ? highlightScanId : null;
  // Seçim (ya da sayfa kümesi) değişince satırın sayfasına geç; yoklama tazelemesi elle seçilen sayfayı ezmez.
  const scanKey = scans.map((s) => s.id).join(",");
  useEffect(() => {
    const i = ownScanId ? scanKey.split(",").indexOf(ownScanId) : -1;
    if (i >= 0) setIdx(i);
  }, [ownScanId, selectionKey, scanKey]);
  const scan = scans[Math.min(idx, scans.length - 1)] ?? null;
  const img = useScanImage(scan?.id ?? null);
  if (!scan)
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Bu taslağın fotoğrafı yok (elle ya da Excel'den açıldı).
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {scans.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {scans.map((s, i) => (
            <Button
              key={s.id}
              size="sm"
              variant={i === idx ? "default" : "outline"}
              onClick={() => setIdx(i)}
            >
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
        <ZoomableScan
          key={scan.id}
          url={img.url}
          alt={`Belge sayfa ${scan.pageNo}`}
          highlight={highlight && (!ownScanId || ownScanId === scan.id) ? highlight : null}
          selectionKey={selectionKey}
        />
      )}
    </div>
  );
}
