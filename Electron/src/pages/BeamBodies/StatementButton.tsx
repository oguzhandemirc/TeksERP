// Devere S6 "Mutabakat bas" — devereci süzgeci TEK firmaya kurulunca görünür. Önce sunucu içerik değiştiyse yeni
// sürüm dondurur (`POST /api/beam-bodies/statement/print`), sonra genel basılı belge diyaloğu açılır (Yazdır / PDF /
// Excel; sürüm geçmişi = devereciye gönderilen mutabakatlar). Excel PDF'i çizen AYNI kolon çözücüsünden (`/tables`).
import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PermissionGate } from "@/components/PermissionGate";
import { PrintedDocDialog, type PrintedDocView } from "@/components/print/PrintedDocDialog";
import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { docTablesToSheets } from "@/lib/doc-tables-export";
import { beamBodyService } from "./service";

/** Süzgeç değeri tek devereci kimliği mi (CSV/dizi = çoklu → düğme yok). */
export function singleSubcontractorId(v: string | string[] | undefined): string | null {
  const one = Array.isArray(v) ? (v.length === 1 ? v[0] : undefined) : v;
  return one && !one.includes(",") ? one : null;
}

export function StatementButton({ subcontractorId }: { subcontractorId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await beamBodyService.printStatement(subcontractorId);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };
  const exportExcel = async (view: PrintedDocView) => {
    try {
      const res = await printedDocumentService.getTables("BEAM_BODY_STATEMENT", subcontractorId, { version: view.version, currentTemplate: view.currentTemplate });
      if (!res.data) throw new Error("belge verisi yok");
      await saveWorkbook(await buildWorkbook(docTablesToSheets(res.data)), `${res.data.documentNo.replace(/\//g, "-")}-govde-mutabakati`);
    } catch (e) {
      toast.error(`Excel üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <PermissionGate permission="beam-body:read">
      <Button size="sm" variant="outline" className="gap-2" disabled={busy} onClick={() => void start()} data-testid="beam-body-statement-open"
        title="Devereciye “sizdeki gövdelerimiz” listesi + son 30 gün giden/dönen hareketler">
        <FileText className="h-4 w-4" /> Mutabakat bas
      </Button>
      {open && (
        <PrintedDocDialog
          docType="BEAM_BODY_STATEMENT"
          sourceId={subcontractorId}
          open
          onOpenChange={setOpen}
          title="Gövde Mutabakatı"
          description="Devereciye gönderilecek gövde listesi. İçerik değiştikçe yeni sürüm doğar; eski sürümler geçmişte durur."
          writePermission="beam-body:write"
          toolbarDownloads={(view) => (
            <DropdownMenuItem onSelect={() => void exportExcel(view)} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </DropdownMenuItem>
          )}
        />
      )}
    </PermissionGate>
  );
}
