// =============================================================================
// RESMÎ TESLİM BORDROSU GÖRÜNTÜLEYİCİ — donmuş BRD belgesi + Excel
// =============================================================================
// Jenerik `PrintedDocDialog` (önizleme · sürüm · revizyon · PDF · yazdır) +
// bordroya özgü "Excel" kalemi. Excel backend'in `/tables` ucundan, PDF'i çizen
// AYNI kolon çözücüsünden gelir; kolon listesi burada YAZILMAZ. Kayıttan hemen
// sonra da, "Bordrolar" listesinden açılışta da bu bileşen kullanılır.
// =============================================================================
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PrintedDocDialog, type PrintedDocView } from "@/components/print/PrintedDocDialog";
import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { docTablesToSheets } from "@/lib/doc-tables-export";

interface Props {
  noteId: string;
  onClose: () => void;
  description: string;
}

export function ChequeNoteDocDialog({ noteId, onClose, description }: Props) {
  // Excel = önizlemedeki PDF: aynı sürüm, aynı "güncel şablonla" seçimi.
  const exportExcel = async (view: PrintedDocView) => {
    try {
      const res = await printedDocumentService.getTables("CHEQUE_DELIVERY_NOTE", noteId, {
        version: view.version,
        currentTemplate: view.currentTemplate,
      });
      if (!res.data) throw new Error("belge verisi yok");
      const blob = await buildWorkbook(docTablesToSheets(res.data));
      await saveWorkbook(blob, res.data.documentNo);
    } catch (e) {
      toast.error(`Excel üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <PrintedDocDialog
      docType="CHEQUE_DELIVERY_NOTE"
      sourceId={noteId}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Çek / Senet Teslim Bordrosu"
      description={description}
      writePermission="finance:write"
      toolbarDownloads={(view) => (
        <DropdownMenuItem onSelect={() => void exportExcel(view)} className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Excel
        </DropdownMenuItem>
      )}
    />
  );
}
