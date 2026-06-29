import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Printer, Tags, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { printHtmlString } from "@/lib/print";
import { labelService } from "@/services/labelService";
import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, downloadWorkbook } from "@/lib/xlsx-export";
import { accountingDispatchService } from "./service";
import { buildDispatchReportSheets } from "./accounting-export";
import type { DispatchListItem } from "./types";

interface Props {
  receiptFor: DispatchListItem | null;
  onClose: () => void;
}

/**
 * Sevk fişi (ürün/çuval/çeki, 3 bölüm) — yazdır / toplu etiket / Excel.
 * TEK KAYNAK: önizleme + baskı backend'in `renderShipmentDispatchHtml` çıktısıdır
 * (SHIPMENT_DISPATCH donmuş belge) → muhasebe fişi ile sevk irsaliyesi BİREBİR aynı.
 * Excel + toplu etiket için yapılandırılmış veri (getReport) ayrıca çekilir.
 */
export function DispatchReceiptDialog({ receiptFor, onClose }: Props) {
  // Baskı/önizleme HTML'i — tek kaynak (irsaliye ile aynı). DISPATCHED'ta donmuş belge var.
  const htmlQ = useQuery({
    queryKey: ["dispatch-doc-html", receiptFor?.id],
    queryFn: () => printedDocumentService.getHtml("SHIPMENT_DISPATCH", receiptFor!.id),
    enabled: Boolean(receiptFor),
    staleTime: 60_000,
  });
  const html = htmlQ.data ?? null;

  // Excel + toplu etiket için yapılandırılmış veri seti (3 bölüm + rollId'ler).
  const reportQ = useQuery({
    queryKey: ["dispatch-report", receiptFor?.id],
    queryFn: () => accountingDispatchService.getReport(receiptFor!.id),
    enabled: Boolean(receiptFor),
    staleTime: 60_000,
  });
  const report = reportQ.data?.data;

  // Saha #7: toplu etiket — fişteki tüm topların etiketini tek belgede bas.
  const bulkLabelMut = useMutation({
    mutationFn: async () => {
      const rollIds = (report?.cekiRows ?? []).map((c) => c.rollId).filter(Boolean);
      if (rollIds.length === 0) throw new Error("Bu sevkiyatta top yok");
      return labelService.getBulkRollLabelsHtml(rollIds);
    },
    onSuccess: (bulkHtml) => printHtmlString(bulkHtml),
    onError: (e: Error) => toast.error(e.message),
  });

  // Tek sevk fişi → Excel (3 sayfa) — açık fişin verisinden.
  const exportReceiptExcel = async () => {
    if (!report) return;
    try {
      const blob = await buildWorkbook(buildDispatchReportSheets(report));
      downloadWorkbook(blob, `Sevk_Fisi_${report.header.shipmentNo}`);
    } catch {
      toast.error("Excel oluşturulamadı");
    }
  };

  return (
    <Dialog open={Boolean(receiptFor)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-w-4xl flex-col">
        <DialogHeader className="flex shrink-0 flex-row items-center justify-between">
          <DialogTitle>Sevk Fişi — {receiptFor?.shipmentNo}</DialogTitle>
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
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!report || bulkLabelMut.isPending}
              onClick={() => bulkLabelMut.mutate()}
            >
              <Tags className="h-4 w-4" /> Toplu Etiket
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!html}
              onClick={() => html && printHtmlString(html)}
            >
              <Printer className="h-4 w-4" /> Yazdır
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
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
  );
}
