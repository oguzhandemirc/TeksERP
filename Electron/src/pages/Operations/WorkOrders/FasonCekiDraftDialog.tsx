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
import { workOrderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  stepId: string;
  stationName: string;
}

/**
 * Erken TASLAK fason çeki önizleme/baskı — bir sonraki fason adımı (boyahane) için,
 * önceki fasonda bekleyen malı projekte ederek. Mal fabrikaya uğramadan fasondan
 * fasona gidecekse çeki erken basılır. Durum DEĞİŞTİRMEZ (sadece HTML). Tek kaynak:
 * backend renderFasonCekiHtml (TASLAK filigranı) — gerçek baskı = TASLAK.
 */
export function FasonCekiDraftDialog({ open, onOpenChange, workOrderId, stepId, stationName }: Props) {
  const htmlQuery = useQuery({
    queryKey: ["fason-ceki-draft", workOrderId, stepId],
    queryFn: () => workOrderService.getDraftFasonCeki(workOrderId, stepId),
    enabled: open,
    staleTime: 0,
  });
  const html = htmlQuery.data?.data?.html ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{stationName} — Çeki Taslağı</DialogTitle>
          <DialogDescription>
            Henüz sevk yapılmadı — bu TASLAK önizlemedir. Mal {stationName}'a gidince gerçek çeki
            (resmî İrsaliye No ile) sevk anında donar.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {htmlQuery.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : html ? (
            <iframe
              title="Çeki Taslağı Önizleme"
              srcDoc={html}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {htmlQuery.isError
                ? "Taslak üretilemedi — önceki fason adımına henüz sevk yapılmamış olabilir."
                : "Belge yüklenemedi."}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button type="button" className="gap-1" disabled={!html} onClick={() => html && printHtmlString(html)}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
