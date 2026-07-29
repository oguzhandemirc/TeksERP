import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
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
import { printHtmlString } from "@/lib/print";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PrintNoteField } from "@/components/print/PrintNoteField";
import { PdfSaveButton } from "@/components/print/PdfSaveButton";
import { freeDocumentService, type FreeDocumentRow } from "@/services/freeDocumentService";

/** Serbest belge önizleme + yazdır/PDF (kendi /html endpoint'i). */
export function FreeDocumentPrintDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: FreeDocumentRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [printNote, setPrintNote] = useState("");
  const debouncedNote = useDebouncedValue(printNote, 400);

  const htmlQuery = useQuery({
    queryKey: ["free-doc-html", doc?.id, debouncedNote],
    queryFn: () => freeDocumentService.getHtml(doc!.id, debouncedNote),
    enabled: open && Boolean(doc),
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{doc?.title ?? "Serbest Belge"}</DialogTitle>
          <DialogDescription>Belge No: {doc?.documentNo}</DialogDescription>
        </DialogHeader>
        <PrintNoteField value={printNote} onChange={setPrintNote} />
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {htmlQuery.isLoading ? (
            <div className="p-4"><Skeleton className="h-64 w-full" /></div>
          ) : html ? (
            <iframe title="Serbest Belge Önizleme" srcDoc={html} className="h-full w-full border-0 bg-white" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Belge yüklenemedi.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <PdfSaveButton html={html} fileName={`${doc?.title ?? "belge"}-${doc?.documentNo ?? ""}`} disabled={!html} />
          <Button type="button" className="gap-1" disabled={!html} onClick={() => html && printHtmlString(html)}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
