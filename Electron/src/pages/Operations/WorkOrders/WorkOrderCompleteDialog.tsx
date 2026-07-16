import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle } from "lucide-react";
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
import { formatNumber } from "@/lib/format";
import { workOrderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string | null;
  workOrderNumber?: string;
  /** Kapatma başarılı olunca tetiklenir (dialog kendini kapatır). */
  onCompleted?: () => void;
}

/**
 * İş emrini MANUEL KAPATMA diyaloğu — güvenli varyant. Önizleme (atlanacak adımlar +
 * engelleyen in-flight top) gösterilir; işlemde/fasonda top varsa backend reddeder
 * ve buton kilitlenir. Onaylanınca IN_PROGRESS → COMPLETED (kalan adımlar SKIPPED).
 */
export function WorkOrderCompleteDialog({
  open,
  onOpenChange,
  workOrderId,
  workOrderNumber,
  onCompleted,
}: Props) {
  const qc = useQueryClient();

  const previewQ = useQuery({
    queryKey: ["work-order-complete-preview", workOrderId],
    queryFn: () => workOrderService.getCompletePreview(workOrderId as string),
    enabled: open && Boolean(workOrderId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  const completeMut = useMutation({
    mutationFn: () => workOrderService.complete(workOrderId as string),
    onSuccess: () => {
      toast.success("İş emri kapatıldı (tamamlandı).");
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      if (workOrderId) {
        void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
        void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      }
      onCompleted?.();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            İş emrini kapat
          </DialogTitle>
          <DialogDescription>
            {workOrderNumber ? <span className="font-mono">{workOrderNumber}</span> : "İş emri"}{" "}
            <span className="font-medium text-foreground">Tamamlandı</span> olarak işaretlenecek.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {previewQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : previewQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <div className="font-medium text-destructive">
                Önizleme yüklenemedi — kapatma onaylanamaz.
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void previewQ.refetch()}
              >
                Yeniden Dene
              </Button>
            </div>
          ) : preview ? (
            preview.canComplete ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-1 font-medium">Bu kapatma şunları yapacak:</div>
                <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                  {preview.remainingSteps.length > 0 ? (
                    <li>
                      <span className="font-medium text-foreground">
                        {preview.remainingSteps.length}
                      </span>{" "}
                      kalan adım{" "}
                      <Badge variant="muted" className="text-[10px]">
                        ATLANDI
                      </Badge>{" "}
                      olacak ({preview.remainingSteps.map((s) => s.stationName).join(", ")})
                    </li>
                  ) : (
                    <li>Kalan (bekleyen) adım yok — tüm adımlar tamamlanmış/atlanmış.</li>
                  )}
                  <li>
                    İş emri durumu{" "}
                    <Badge variant="muted" className="text-[10px]">
                      TAMAMLANDI
                    </Badge>{" "}
                    olacak
                  </li>
                  <li>Aktif refakat kartları tamamlandı olarak işaretlenecek</li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                İşlemde/fasonda top olmadığı için güvenle kapatılabilir. Kapatılan iş emri
                yalnız parti ayırma / manuel taşıma ile yeniden açılır.
              </p>
            </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-xs text-warning-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <span>{preview.blockReason}</span>
                </div>
                {preview.inFlight.count > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      İşlemdeki toplar ({preview.inFlight.count} top ·{" "}
                      {formatNumber(preview.inFlight.totalMeters, 0)} m)
                    </div>
                    <ul className="space-y-1 rounded-md border p-2">
                      {preview.inFlight.byStep.map((s) => (
                        <li
                          key={s.stationName}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-medium">{s.stationName}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {s.count} top · {formatNumber(s.meters, 0)} m
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={!preview?.canComplete || completeMut.isPending}
            className="bg-success text-success-foreground hover:bg-success/90"
            onClick={() => completeMut.mutate()}
          >
            {completeMut.isPending ? "Kapatılıyor..." : "İş emrini kapat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
