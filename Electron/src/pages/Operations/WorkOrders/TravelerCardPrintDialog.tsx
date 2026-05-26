import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { PDFDownloadLink, PDFViewer } from "@react-pdf/renderer";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { workOrderService } from "./service";
import { TravelerCardPdfDocument } from "./TravelerCardPdfDocument";
import type { WorkOrder, TravelerCard } from "./types";

interface Props {
  workOrder: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TravelerCardPrintDialog({ workOrder, open, onOpenChange }: Props) {
  const cardQuery = useQuery({
    queryKey: ["traveler-cards", workOrder?.id],
    queryFn: () => workOrderService.getTravelerCardHistory(workOrder!.id),
    enabled: open && Boolean(workOrder?.id),
    staleTime: 30_000,
  });

  const activeCard = useMemo<TravelerCard | null>(() => {
    const cards = cardQuery.data?.data ?? [];
    return cards.find((c) => c.status === "ACTIVE") ?? cards[0] ?? null;
  }, [cardQuery.data?.data]);

  /* QR Canvas → PNG dataURL roundtrip. react-pdf Image SVG embed etmediği için
     PNG'ye çeviriyoruz. Hidden div'de QRCodeCanvas render, useEffect canvas'tan
     dataURL çeker. */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCard) {
      setQrDataUrl(null);
      return;
    }
    // QRCodeCanvas mount sonrası senkron çizer; ref dolar dolmaz dataURL'i al.
    if (canvasRef.current) {
      setQrDataUrl(canvasRef.current.toDataURL("image/png"));
    }
  }, [activeCard?.barcode]);

  if (!workOrder) return null;

  const isReady = !cardQuery.isLoading && activeCard != null && qrDataUrl != null;
  const fileName = activeCard ? `${activeCard.cardNumber}.pdf` : "refakat-karti.pdf";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] max-w-5xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Refakat Kartı — Önizleme</DialogTitle>
          <DialogDescription>
            A5 yatay. Viewer üzerinden yazdırabilir veya PDF olarak indirebilirsin.
          </DialogDescription>
        </DialogHeader>

        {/* Hidden QR canvas — yüksek çözünürlükte üret, PDF'te 110pt'ye scale edilir */}
        {activeCard && (
          <div style={{ position: "absolute", left: -10000, top: 0 }}>
            <QRCodeCanvas
              ref={canvasRef}
              value={activeCard.barcode}
              size={512}
              level="M"
              marginSize={0}
            />
          </div>
        )}

        <div className="flex-1 overflow-hidden rounded-md border bg-muted/30">
          {cardQuery.isLoading && (
            <div className="space-y-2 p-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}

          {!cardQuery.isLoading && !activeCard && (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Aktif refakat kartı bulunamadı.
            </div>
          )}

          {isReady && (
            <PDFViewer
              key={activeCard.id}
              width="100%"
              height="100%"
              showToolbar
              style={{ border: 0 }}
            >
              <TravelerCardPdfDocument
                workOrder={workOrder}
                card={activeCard}
                qrDataUrl={qrDataUrl}
              />
            </PDFViewer>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          {isReady && (
            <PDFDownloadLink
              document={
                <TravelerCardPdfDocument
                  workOrder={workOrder}
                  card={activeCard}
                  qrDataUrl={qrDataUrl}
                />
              }
              fileName={fileName}
            >
              {({ loading }) => (
                <Button type="button" disabled={loading} className="gap-1">
                  <Download className="h-4 w-4" />
                  {loading ? "Hazırlanıyor…" : "PDF İndir"}
                </Button>
              )}
            </PDFDownloadLink>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
