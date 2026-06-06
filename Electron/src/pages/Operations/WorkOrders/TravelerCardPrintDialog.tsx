import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";
import { PDFDownloadLink, PDFViewer, pdf } from "@react-pdf/renderer";
import { Download, Printer, RefreshCw } from "lucide-react";
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
import { DEFAULT_TRAVELER_CARD_CONFIG } from "@/services/featureFlagService";
import type { WorkOrder, TravelerCard } from "./types";

interface Props {
  workOrder: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TravelerCardPrintDialog({ workOrder, open, onOpenChange }: Props) {
  // reloadKey artırıldığında QRCodeCanvas + PDFViewer remount olur, dataURL
  // sıfırdan üretilir. "Yenile" tuşu içinde takılmış görüntüyü düşürür.
  const [reloadKey, setReloadKey] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const cardQuery = useQuery({
    queryKey: ["traveler-cards", workOrder?.id],
    queryFn: () => workOrderService.getTravelerCardHistory(workOrder!.id),
    enabled: open && Boolean(workOrder?.id),
    staleTime: 30_000,
  });

  // PDF içeriği için ZENGİNLEŞTİRİLMİŞ WO gerekir (targetItem/targetColor/
  // orderLinks/targetProperties). Liste satırından açılınca prop'taki WO hafif
  // gelir → bu alanlar boş basılırdı. getById ile zenginleştir; sheet/sayfa
  // aynı ['work-order-detail', id] cache'ini doldurduğundan ekstra istek olmaz.
  const woDetailQuery = useQuery({
    queryKey: ["work-order-detail", workOrder?.id],
    queryFn: () => workOrderService.getById(workOrder!.id),
    enabled: open && Boolean(workOrder?.id),
    staleTime: 60_000,
  });
  const wo = woDetailQuery.data?.data ?? workOrder;

  const activeCard = useMemo<TravelerCard | null>(() => {
    const cards = cardQuery.data?.data ?? [];
    return cards.find((c) => c.status === "ACTIVE") ?? cards[0] ?? null;
  }, [cardQuery.data?.data]);

  // Marka/içerik ayarı: kartın kendi snapshot'ından (basım anında dondurulmuş);
  // eski kartlarda yoksa varsayılana düşer.
  const cardConfig = activeCard?.snapshot?.config ?? DEFAULT_TRAVELER_CARD_CONFIG;

  /* QR Canvas → PNG dataURL. react-pdf Image PNG bekliyor.
     Callback ref ile canvas attach edildiğinde tek frame bekleyip dataURL
     okuyoruz: ref attach commit fazında, QRCodeCanvas'ın çizim useEffect'i
     ise commit sonrası fire olur. Aynı tick'te toDataURL çağırsak boş PNG
     alma riski var — RAF bir frame sonraya alıp drawing'in flush olmasını
     garantiler. Önceki useRef + useEffect kurgusunda effect sırası bozulup
     `canvasRef.current` boş çıkıyor, viewer beyaz kalıyordu. */
  const handleCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) {
      setQrDataUrl(null);
      return;
    }
    requestAnimationFrame(() => {
      setQrDataUrl(canvas.toDataURL("image/png"));
    });
  }, []);

  const handleHardRefresh = () => {
    setQrDataUrl(null);
    setReloadKey((k) => k + 1);
    void cardQuery.refetch();
  };

  const [isPrinting, setIsPrinting] = useState(false);

  /* Direkt yazdır: PDF'i Blob olarak üret, gizli iframe'e yükle ve
     contentWindow.print() çağır. Viewer toolbar'ına gitmeye gerek kalmadan
     tek tıkla yazıcı dialog'u açılır. iframe + objectURL print sonrası
     temizlenir. */
  const handlePrint = async () => {
    if (!workOrder || !activeCard || !qrDataUrl) return;
    setIsPrinting(true);
    try {
      const blob = await pdf(
        <TravelerCardPdfDocument
          workOrder={activeCard.snapshot ?? wo ?? workOrder}
          card={activeCard}
          qrDataUrl={qrDataUrl}
          config={cardConfig}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.src = url;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (err) {
          console.error("Yazdırma hatası:", err);
          toast.error(
            `Yazdırma başlatılamadı: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
      document.body.appendChild(iframe);

      // Yazıcı dialog'u kapandıktan sonra iframe + objectURL temizlenir.
      // Bir süre bekliyoruz çünkü print() senkron değil, kapatma eventi
      // tarayıcıya göre değişiyor (Electron'da afterprint var ama tüm
      // tarayıcılarda garanti değil — timeout güvenli fallback).
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 60_000);
    } catch (err) {
      console.error("PDF üretim hatası:", err);
      toast.error(
        `PDF oluşturulamadı: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsPrinting(false);
    }
  };

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

        {/* Hidden QR canvas — yüksek çözünürlükte üret, PDF'te 110pt'ye scale edilir.
            key: barcode + reloadKey → barkod değişince ya da kullanıcı yenilediğinde
            QRCodeCanvas remount olur ve callback ref yeniden tetiklenir. */}
        {activeCard && (
          <div style={{ position: "absolute", left: -10000, top: 0 }}>
            <QRCodeCanvas
              key={`${activeCard.barcode}-${reloadKey}`}
              ref={handleCanvas}
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
              key={`${activeCard.id}-${reloadKey}`}
              width="100%"
              height="100%"
              showToolbar
              style={{ border: 0 }}
            >
              <TravelerCardPdfDocument
                workOrder={activeCard.snapshot ?? wo ?? workOrder}
                card={activeCard}
                qrDataUrl={qrDataUrl}
                config={cardConfig}
              />
            </PDFViewer>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleHardRefresh}
            disabled={cardQuery.isFetching}
            className="gap-1"
            title="Önizleme takılırsa yeniden yükle"
          >
            <RefreshCw className={cardQuery.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Yenile
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          {isReady && (
            <>
              <PDFDownloadLink
                document={
                  <TravelerCardPdfDocument
                    workOrder={activeCard.snapshot ?? wo ?? workOrder}
                    card={activeCard}
                    qrDataUrl={qrDataUrl}
                    config={cardConfig}
                  />
                }
                fileName={fileName}
              >
                {({ loading }) => (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    className="gap-1"
                  >
                    <Download className="h-4 w-4" />
                    {loading ? "Hazırlanıyor…" : "PDF İndir"}
                  </Button>
                )}
              </PDFDownloadLink>
              <Button
                type="button"
                onClick={handlePrint}
                disabled={isPrinting}
                className="gap-1"
              >
                <Printer className="h-4 w-4" />
                {isPrinting ? "Hazırlanıyor…" : "Yazdır"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
