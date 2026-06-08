import { useCallback, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { PDFViewer } from "@react-pdf/renderer";
import { Skeleton } from "@/components/ui/skeleton";
import type { TravelerCardConfig } from "@/services/featureFlagService";
import { TravelerCardPdfDocument } from "@/pages/Operations/WorkOrders/TravelerCardPdfDocument";
import { MOCK_TRAVELER_WO, MOCK_TRAVELER_CARD } from "./previewMocks";

/**
 * Refakat Kartı canlı önizlemesi. Kart react-pdf belgesi olduğundan TravelerCard
 * PrintDialog deseni: gizli QRCodeCanvas → toDataURL (RAF) → <PDFViewer>. Taslak
 * config prop'u PDF'e geçer; ayar değişince viewer yeniden render eder. Örnek veri.
 */
export function TravelerCardPreview({ config }: { config: TravelerCardConfig }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // QR canvas → PNG dataURL (react-pdf Image PNG bekler). RAF: çizim flush olsun.
  const handleCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) {
      setQrDataUrl(null);
      return;
    }
    requestAnimationFrame(() => setQrDataUrl(canvas.toDataURL("image/png")));
  }, []);

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Önizleme — örnek veri (A4)
      </div>

      {/* Gizli yüksek çözünürlüklü QR — PDF'te scale edilir. */}
      <div style={{ position: "absolute", left: -10000, top: 0 }}>
        <QRCodeCanvas
          ref={handleCanvas}
          value={MOCK_TRAVELER_CARD.barcode}
          size={512}
          level="M"
          marginSize={0}
        />
      </div>

      <div className="h-[70vh]">
        {qrDataUrl ? (
          <PDFViewer width="100%" height="100%" showToolbar style={{ border: 0 }}>
            <TravelerCardPdfDocument
              workOrder={MOCK_TRAVELER_WO}
              card={MOCK_TRAVELER_CARD}
              qrDataUrl={qrDataUrl}
              config={config}
            />
          </PDFViewer>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
    </div>
  );
}
