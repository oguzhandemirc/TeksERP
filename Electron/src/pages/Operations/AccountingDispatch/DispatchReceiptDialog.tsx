import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Printer, Tags } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { printHtmlString } from "@/lib/print";
import { labelService } from "@/services/labelService";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";
import { printedDocumentService } from "@/services/printedDocumentService";
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
  // Yapılandırılmış seri/COM Argox varsa toplu etiketi TEK native job'la diyalogsuz bas.
  const { directEnabled, printRollsBulk, peripheralId } = useLabelPrinter();

  // Toplu etiketteki topların id'leri + WYSIWYG önizleme (ilk top, aktif dilde).
  // peripheralId: önizleme bu PC'ye seçili yazıcının dilinde çözülür (baskıyla aynı).
  const rollIds = (report?.cekiRows ?? []).map((c) => c.rollId).filter(Boolean);
  const [labelOpen, setLabelOpen] = useState(false);
  const labelPreviewQ = useQuery({
    queryKey: ["dispatch-bulk-label-preview", rollIds[0], peripheralId],
    queryFn: () => labelService.getRollPreview(rollIds[0]!, undefined, peripheralId),
    enabled: labelOpen && rollIds.length > 0,
    staleTime: 0,
  });
  const lp = labelPreviewQ.data;

  // Saha #7: toplu etiket — fişteki tüm topların etiketini tek baskıda çıkar.
  const bulkLabelMut = useMutation({
    mutationFn: async () => {
      if (rollIds.length === 0) throw new Error("Bu sevkiyatta top yok");
      if (directEnabled) {
        // Diyalogsuz: N farklı topun PPLA'sı tek seri/COM gönderiminde.
        const r = await printRollsBulk(rollIds);
        if (!r.ok) throw new Error(r.error ?? "Yazıcıya gönderilemedi");
        return null;
      }
      const bulkHtml = await labelService.getBulkRollLabelsHtml(rollIds);
      await printHtmlString(bulkHtml);
      return null;
    },
    onSuccess: () => {
      if (directEnabled) toast.success("Etiketler yazıcıya gönderildi.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!report || rollIds.length === 0}
              onClick={() => setLabelOpen(true)}
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

    {/* Toplu etiket önizleme — ilk topun aktif-dil WYSIWYG'i + kaç top basılacağı */}
    <Dialog open={labelOpen} onOpenChange={(o) => !o && setLabelOpen(false)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Toplu Etiket — {rollIds.length} top</DialogTitle>
        </DialogHeader>
        {lp && (
          <div className="text-[11px] text-muted-foreground">
            Aktif dil: <strong>{lp.language}</strong> · ilk top gösteriliyor ({rollIds.length} top basılacak)
          </div>
        )}
        {labelPreviewQ.isLoading ? (
          <Skeleton className="h-[440px] w-full" />
        ) : lp?.mode === "text" ? (
          <pre className="h-[440px] w-full overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/20 p-3 font-mono text-[11px]">{lp.content}</pre>
        ) : (
          <iframe title="Toplu etiket önizleme" srcDoc={lp?.content ?? ""} sandbox="allow-same-origin allow-modals" className="h-[440px] w-full rounded border bg-white" />
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setLabelOpen(false)}>İptal</Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={bulkLabelMut.isPending || rollIds.length === 0}
            onClick={() => { bulkLabelMut.mutate(); setLabelOpen(false); }}
          >
            <Printer className="h-4 w-4" /> {bulkLabelMut.isPending ? "Basılıyor…" : `${rollIds.length} etiketi bas`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
