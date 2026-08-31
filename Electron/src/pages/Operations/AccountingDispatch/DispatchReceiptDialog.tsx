import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { printHtmlString } from "@/lib/print";
import { printedDocumentService } from "@/services/printedDocumentService";
import { BulkRollLabelButton } from "@/components/print/BulkRollLabelButton";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { accountingDispatchService } from "./service";
import { buildDispatchReportSheets } from "./accounting-export";
import type { DispatchListItem } from "./types";

interface Props {
  receiptFor: DispatchListItem | null;
  onClose: () => void;
}

/**
 * Sevk fişi (kumaş/çuval/çeki, 3 bölüm) — yazdır / toplu etiket / Excel.
 * TEK KAYNAK: önizleme + baskı backend'in `renderShipmentDispatchHtml` çıktısıdır
 * (SHIPMENT_DISPATCH donmuş belge) → muhasebe fişi ile sevk irsaliyesi BİREBİR aynı.
 * Excel + toplu etiket için yapılandırılmış veri (getReport) ayrıca çekilir.
 */
export function DispatchReceiptDialog({ receiptFor, onClose }: Props) {
  // DIRECT (fasondan doğrudan sevk) satırı → kendi donmuş irsaliyesi (SUBCONTRACTOR_DIRECT_SHIP)
  // + kendi rapor ucu (çuval yok). Çuval sevkiyatı → SHIPMENT_DISPATCH + dispatch-report.
  const isDirect = receiptFor?.kind === "DIRECT";
  const docType = isDirect ? "SUBCONTRACTOR_DIRECT_SHIP" : "SHIPMENT_DISPATCH";

  // Baskı/önizleme HTML'i — tek kaynak (irsaliye ile aynı). DISPATCHED'ta donmuş belge var.
  const htmlQ = useQuery({
    queryKey: ["dispatch-doc-html", docType, receiptFor?.id],
    queryFn: () => printedDocumentService.getHtml(docType, receiptFor!.id),
    enabled: Boolean(receiptFor),
    staleTime: 60_000,
  });
  const html = htmlQ.data ?? null;

  // Excel + toplu etiket için yapılandırılmış veri seti (3 bölüm + rollId'ler).
  const reportQ = useQuery({
    queryKey: ["dispatch-report", isDirect ? "direct" : "shipment", receiptFor?.id],
    queryFn: () =>
      isDirect
        ? accountingDispatchService.getDirectReport(receiptFor!.id)
        : accountingDispatchService.getReport(receiptFor!.id),
    enabled: Boolean(receiptFor),
    staleTime: 60_000,
  });
  const report = reportQ.data?.data;
  // Toplu etiketteki topların id'leri — düğme + önizleme ORTAK bileşende
  // (BulkRollLabelButton); yazıcı dallanması orada tek yerde yaşıyor.
  const rollIds = (report?.cekiRows ?? []).map((c) => c.rollId).filter(Boolean);

  // Tek sevk fişi → Excel (3 sayfa) — açık fişin verisinden.
  const exportReceiptExcel = async () => {
    if (!report) return;
    try {
      const blob = await buildWorkbook(buildDispatchReportSheets(report));
      await saveWorkbook(blob, `Sevk_Fisi_${report.header.shipmentNo}`);
    } catch {
      toast.error("Excel oluşturulamadı");
    }
  };

  return (
    <>
    <Dialog open={Boolean(receiptFor)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-w-4xl flex-col">
        <DialogHeader className="flex shrink-0 flex-row items-center justify-between pr-8">
          <DialogTitle className="flex items-center gap-2">
            <span>Sevk Fişi — {receiptFor?.shipmentNo}</span>
            {isDirect && (
              <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
                Fasondan Sevk
              </Badge>
            )}
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!report}
              onClick={exportReceiptExcel}
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <BulkRollLabelButton rollIds={rollIds} className="gap-1.5" />
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!html}
              onClick={() => html && printHtmlString(html)}
            >
              <Printer className="h-4 w-4" /> Yazdır
            </Button>
            {/* Kapatma: DialogContent'in yerleşik (sağ üst) X'i kullanılır — burada
                ikinci bir X BASILMAZ (çift çıkış butonu olmasın). */}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/20">
          {htmlQ.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-96 w-full" />
            </div>
          ) : html ? (
            <iframe
              title="Sevk Fişi Önizleme"
              srcDoc={html}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">Fiş yüklenemedi.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>

    </>
  );
}
