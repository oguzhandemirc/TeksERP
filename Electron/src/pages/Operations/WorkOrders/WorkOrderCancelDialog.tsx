import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { workOrderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string | null;
  batchNumber?: string;
  /** İptal başarılı olunca tetiklenir (dialog kendini kapatır). */
  onCancelled?: () => void;
}

export function WorkOrderCancelDialog({
  open,
  onOpenChange,
  workOrderId,
  batchNumber,
  onCancelled,
}: Props) {
  const qc = useQueryClient();

  const impactQ = useQuery({
    queryKey: ["work-order-cancel-impact", workOrderId],
    queryFn: () => workOrderService.getCancelImpact(workOrderId as string),
    enabled: open && Boolean(workOrderId),
    staleTime: 0,
  });
  const impact = impactQ.data?.data;

  const cancelMut = useMutation({
    mutationFn: () => workOrderService.remove(workOrderId as string),
    onSuccess: () => {
      toast.success("İş emri iptal edildi, bağlı toplar stoğa çekildi.");
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      if (workOrderId) {
        void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      }
      onCancelled?.();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            İş emrini iptal et
          </DialogTitle>
          <DialogDescription>
            {batchNumber ? (
              <span className="font-mono">{batchNumber}</span>
            ) : (
              "İş emri"
            )}{" "}
            iptal edilecek. Bu işlem geri alınamaz.
          </DialogDescription>
        </DialogHeader>

        {impactQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : impact ? (
          impact.canCancel ? (
            <div className="space-y-3 text-sm">
              {impact.atSubcontractorCount > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <span className="font-semibold">
                      {impact.atSubcontractorCount} top hâlâ fasonda/boyahanede.
                    </span>{" "}
                    İptal bunları STOK'a çeker ama fiziksel olarak orada bırakır —
                    sistemde stokta görünür, gerçekte dışarıda olur. Önce fason
                    kabul/iade yapman önerilir.
                  </div>
                </div>
              )}
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-1 font-medium">Bu iptal şunları yapacak:</div>
                <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                  <li>
                    <span className="font-medium text-foreground">
                      {impact.rollCount}
                    </span>{" "}
                    kumaş topu{" "}
                    <Badge variant="muted" className="text-[10px]">
                      STOK
                    </Badge>
                    'a geri çekilecek
                    {impact.processedCount > 0 && (
                      <>
                        {" "}
                        (
                        <span className="font-medium text-foreground">
                          {impact.processedCount}
                        </span>{" "}
                        tanesi işlenmiş/boyalı — ham değil)
                      </>
                    )}
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      {impact.travelerCardCount}
                    </span>{" "}
                    aktif refakat kartı iptal (VOID) olacak
                  </li>
                  <li>
                    İş emri durumu{" "}
                    <Badge variant="muted" className="text-[10px]">
                      CANCELLED
                    </Badge>{" "}
                    olacak
                  </li>
                </ul>
              </div>

              {impact.rolls.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stoğa dönecek toplar ({impact.rolls.length})
                  </div>
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {impact.rolls.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                          {r.colorName && (
                            <Badge variant="muted" className="gap-1 text-[10px]">
                              {r.colorHex && (
                                <span
                                  className="h-2 w-2 rounded-full border"
                                  style={{ backgroundColor: r.colorHex }}
                                />
                              )}
                              {r.colorName}
                            </Badge>
                          )}
                          {r.processed && (
                            <Badge variant="outline" className="text-[10px] text-amber-600">
                              işlenmiş
                            </Badge>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={r.atSubcontractor ? "outline" : "muted"}
                            className={
                              r.atSubcontractor
                                ? "text-[10px] text-destructive"
                                : "text-[10px]"
                            }
                          >
                            {r.status}
                          </Badge>
                          <span className="tabular-nums text-muted-foreground">
                            {r.currentQty} m
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {impact.blockReason}
            </div>
          )
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={!impact?.canCancel || cancelMut.isPending}
            onClick={() => cancelMut.mutate()}
          >
            {cancelMut.isPending ? "İptal ediliyor..." : "İş emrini iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
