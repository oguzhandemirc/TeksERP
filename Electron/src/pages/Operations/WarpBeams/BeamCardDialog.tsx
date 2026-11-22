// A6 levent kartı (`WARP_BEAM_CARD`, kaynak WarpBeam) — donmuş belge görüntüleyicisi + Excel. İçerik sarımın (WOUND)
// kopyasından; iptal edilmiş levent 409 `WARP_BEAM_CARD_CANCELLED`, sarılmamış 409 `WARP_BEAM_CARD_NOT_WOUND`.
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PrintedDocDialog, type PrintedDocView } from "@/components/print/PrintedDocDialog";
import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { docTablesToSheets } from "@/lib/doc-tables-export";
import type { WarpBeam } from "./types";

/** Kart yalnız sarılmış ve iptal edilmemiş levente basılır (sunucu da 409 verir). */
export function isBeamCardPrintable(b: Pick<WarpBeam, "status">): boolean {
  return b.status !== "PLANNED" && b.status !== "CANCELLED";
}

export function BeamCardDialog({ beam, onClose }: { beam: Pick<WarpBeam, "id" | "beamNo">; onClose: () => void }) {
  const exportExcel = async (view: PrintedDocView) => {
    try {
      const res = await printedDocumentService.getTables("WARP_BEAM_CARD", beam.id, { version: view.version, currentTemplate: view.currentTemplate });
      if (!res.data) throw new Error("belge verisi yok");
      const blob = await buildWorkbook(docTablesToSheets(res.data));
      await saveWorkbook(blob, `${res.data.documentNo}-levent-karti`);
    } catch (e) {
      toast.error(`Excel üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <PrintedDocDialog
      docType="WARP_BEAM_CARD"
      sourceId={beam.id}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Levent Kartı"
      description={`${beam.beamNo} — levent kılıfına takılan A6 kart: gövde, çözgü, iplik kırılımı ve lotlar.`}
      writePermission="warpbeam:write"
      toolbarDownloads={(view) => (
        <DropdownMenuItem onSelect={() => void exportExcel(view)} className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Excel
        </DropdownMenuItem>
      )}
    />
  );
}
