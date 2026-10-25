// Muayene raporu (`INSPECTION_REPORT`, kaynak Shipment) — donmuş belge görüntüleyicisi + Excel.
// Excel PDF'i çizen AYNI kolon çözücüsünden (`/tables`) gelir; panelde kolon listesi yazılmaz.
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PrintedDocDialog, type PrintedDocView } from "@/components/print/PrintedDocDialog";
import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { docTablesToSheets } from "@/lib/doc-tables-export";

interface Props {
  shipmentId: string;
  shipmentNo?: string | null;
  onClose: () => void;
}

export function InspectionReportDialog({ shipmentId, shipmentNo, onClose }: Props) {
  const exportExcel = async (view: PrintedDocView) => {
    try {
      const res = await printedDocumentService.getTables("INSPECTION_REPORT", shipmentId, {
        version: view.version,
        currentTemplate: view.currentTemplate,
      });
      if (!res.data) throw new Error("belge verisi yok");
      const blob = await buildWorkbook(docTablesToSheets(res.data));
      await saveWorkbook(blob, `${res.data.documentNo}-muayene`);
    } catch (e) {
      toast.error(`Excel üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <PrintedDocDialog
      docType="INSPECTION_REPORT"
      sourceId={shipmentId}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Muayene Raporu"
      description={`${shipmentNo ? `Sevkiyat ${shipmentNo} — ` : ""}Sevk toplarının 4 puan muayeneleri, müşteri kuralına göre etiket ve sonuç.`}
      writePermission="inspection:correct"
      toolbarDownloads={(view) => (
        <DropdownMenuItem onSelect={() => void exportExcel(view)} className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Excel
        </DropdownMenuItem>
      )}
    />
  );
}
