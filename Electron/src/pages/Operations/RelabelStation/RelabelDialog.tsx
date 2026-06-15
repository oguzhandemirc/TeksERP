import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { relabelService } from "./service";
import { RelabelSpecForm } from "./RelabelSpecForm";
import { RelabelPrintForCustomer } from "./RelabelPrintForCustomer";
import { LastLabelBanner, RollContextHeader } from "./RollContextHeader";

interface Props {
  /** Açılacak topun barkodu — null/boş = kapalı. Açık kumaş (barkodsuz) için kullanılmaz. */
  barcode: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Yeniden-Etiketleme'nin ikinci giriş noktası — Toplar detayından (RollDetailSheet)
 * açılır. İstasyon sayfasıyla aynı iki bileşeni (RelabelSpecForm + RelabelPrintForCustomer)
 * paylaşır; bağlamı barkodla çeker. Spec/baskı sonrası bağlam invalidate ile tazelenir.
 */
export function RelabelDialog({ barcode, onOpenChange }: Props) {
  const open = Boolean(barcode);
  const qc = useQueryClient();

  const ctxQuery = useQuery({
    queryKey: ["relabel-context", barcode],
    queryFn: () => relabelService.getContext(barcode!),
    enabled: open,
    staleTime: 0,
  });
  const ctx = ctxQuery.data?.data ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["relabel-context", barcode] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Yeniden Etiketle</DialogTitle>
          <DialogDescription>
            Topun spec'ini düzelt ya da farklı müşteri için etiketi yeniden bas.
          </DialogDescription>
        </DialogHeader>

        {ctxQuery.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : ctxQuery.isError ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
            Bağlam alınamadı: {(ctxQuery.error as Error).message}
          </div>
        ) : ctx ? (
          <div className="space-y-4">
            <RollContextHeader ctx={ctx} onClear={() => onOpenChange(false)} />
            <LastLabelBanner snap={ctx.lastLabelSnapshot} />
            <div className="grid gap-4">
              <RelabelSpecForm key={ctx.id} ctx={ctx} onSaved={refresh} />
              <RelabelPrintForCustomer key={ctx.id} ctx={ctx} onPrinted={refresh} />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
