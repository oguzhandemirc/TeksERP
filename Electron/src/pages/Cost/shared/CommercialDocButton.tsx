// Teklif / fiyat listesi basılı belgesi (MAL-6) — Yazdır / PDF / Excel. DRAFT'ta sunucu TASLAK önizlemesi döner
// (donmaz); Excel PDF'i çizen AYNI kolon çözücüsünden (`/tables`) gelir, panelde kolon listesi yazılmaz.
import { useState } from "react";
import { FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PrintedDocDialog, type PrintedDocView } from "@/components/print/PrintedDocDialog";
import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { docTablesToSheets } from "@/lib/doc-tables-export";

export type CommercialDocType = "SALES_QUOTE" | "PRICE_LIST";

const META: Record<CommercialDocType, { title: string; suffix: string; write: string }> = {
  SALES_QUOTE: { title: "Satış Teklifi", suffix: "teklif", write: "quote:write" },
  PRICE_LIST: { title: "Fiyat Listesi", suffix: "fiyat-listesi", write: "price-list:write" },
};

interface Props {
  docType: CommercialDocType;
  sourceId: string;
  label: string;
  draft: boolean;
}

export function CommercialDocButton({ docType, sourceId, label, draft }: Props) {
  const [open, setOpen] = useState(false);
  const m = META[docType];
  const exportExcel = async (view: PrintedDocView) => {
    try {
      const res = await printedDocumentService.getTables(docType, sourceId, {
        version: view.version,
        currentTemplate: view.currentTemplate,
        ...(draft ? { draft: true } : {}),
      });
      if (!res.data) throw new Error("belge verisi yok");
      const blob = await buildWorkbook(docTablesToSheets(res.data));
      await saveWorkbook(blob, `${res.data.documentNo.replace(/\//g, "-")}-${m.suffix}`);
    } catch (e) {
      toast.error(`Excel üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" className="gap-2" onClick={() => setOpen(true)} data-testid="commercial-doc-open">
        <Printer className="h-4 w-4" />
        Yazdır / PDF / Excel
      </Button>
      {open && (
        <PrintedDocDialog
          docType={docType}
          sourceId={sourceId}
          open
          onOpenChange={setOpen}
          title={m.title}
          description={draft ? `${label} — taslak önizleme; belge gönderim/yayın sonrası ilk basımda donar.` : label}
          writePermission={m.write}
          allowDraft={draft}
          toolbarDownloads={(view) => (
            <DropdownMenuItem onSelect={() => void exportExcel(view)} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </DropdownMenuItem>
          )}
        />
      )}
    </>
  );
}
