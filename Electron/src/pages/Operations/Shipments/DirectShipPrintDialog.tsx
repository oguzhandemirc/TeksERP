import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
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
import { printedDocumentService } from "@/services/printedDocumentService";

interface Props {
  /** DirectShipment.id — SUBCONTRACTOR_DIRECT_SHIP irsaliyesinin sourceId'si. */
  directShipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
}

/**
 * Fasondan Doğrudan Sevk İrsaliyesi — sevk anında dondurulan resmi belge (backend
 * HTML, her cihazda birebir aynı). Doğrudan sevk terminaldir → tek versiyon, overlay
 * yok; FasonSevkPrintDialog'un aksine sade: getHtml → iframe → yazdır.
 */
export function DirectShipPrintDialog({ directShipmentId, open, onOpenChange, onBack }: Props) {
  const htmlQuery = useQuery({
    queryKey: ["printed-doc-html", "SUBCONTRACTOR_DIRECT_SHIP", directShipmentId],
    queryFn: () =>
      printedDocumentService.getHtml("SUBCONTRACTOR_DIRECT_SHIP", directShipmentId!),
    enabled: open && Boolean(directShipmentId),
    staleTime: 30_000,
  });
  const html = htmlQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Doğrudan Sevk İrsaliyesi</DialogTitle>
          <DialogDescription>
            Sevk anında dondurulan resmi belge — önizleme baskıyla birebir aynı.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {htmlQuery.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : html ? (
            <iframe
              title="Doğrudan Sevk İrsaliyesi Önizleme"
              srcDoc={html}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Belge yüklenemedi.
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {onBack ? (
            <Button
              type="button"
              variant="outline"
              className="gap-1 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" /> Detaya Dön
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Kapat
            </Button>
            <Button
              type="button"
              className="gap-1"
              disabled={!html}
              onClick={() => html && printHtmlString(html)}
            >
              <Printer className="h-4 w-4" /> Yazdır
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
