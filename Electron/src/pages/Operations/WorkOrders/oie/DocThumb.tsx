// Formun yanındaki küçük belge önizlemesi (ilk okunabilir sayfa); büyük görünüm Gelen Belgeler detayında.
import { useScanImage } from "@/pages/Operations/GelenBelgeler/useScanImage";
import { isScanPurged, SCAN_PURGED_TEXT } from "@/pages/Operations/GelenBelgeler/photoRetention";
import { PDF_MIME } from "@/pages/Operations/GelenBelgeler/uploadPrep";
import type { DocumentScanInfo } from "@/pages/Operations/GelenBelgeler/types";

export function DocThumb({ scans, className }: { scans: readonly DocumentScanInfo[]; className?: string }) {
  const scan = scans.find((s) => s.mimeType !== PDF_MIME) ?? null;
  const img = useScanImage(scan?.id ?? null, { purged: isScanPurged(scan) });
  return (
    <div className={`overflow-hidden rounded-lg border bg-muted/30 ${className ?? ""}`} data-testid="oie-doc-thumb">
      {img.url ? (
        <img src={img.url} alt="Belge önizlemesi" className="max-h-[420px] w-full object-contain" />
      ) : (
        <p className="p-4 text-center text-xs text-muted-foreground">{!scan ? "Önizlenecek fotoğraf yok." : img.purged ? SCAN_PURGED_TEXT : "Önizleme yükleniyor…"}</p>
      )}
    </div>
  );
}
