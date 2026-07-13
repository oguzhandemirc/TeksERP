import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wrench, AlertTriangle, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import { manualAdjustService } from "./manualAdjustService";

interface Props {
  /** Kurtarılacak topun id'si — null = kapalı. */
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Başarılı kurtarmadan sonra (detay panelini tazelemek için). */
  onRescued?: () => void;
}

const statusLabel = (s: RollStatus): string => rollStatusLabels[s] ?? s;

/**
 * "İstasyondan Kurtar" — makinede/istasyonda takılı (IN_PRODUCTION) topu depoya
 * (WAREHOUSE) alır. Süpervizör aksiyonu (roll:manual-adjust); zorunlu sebep + audit.
 * Backend açık hareketleri fiziksel çıkışla kapatır, barkodsuzsa final etiket üretir.
 */
export function RescueStuckDialog({ rollId, onOpenChange, onRescued }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();
  const [reason, setReason] = useState<string>("");

  const previewQ = useQuery({
    queryKey: ["rescue-preview", rollId],
    queryFn: () => manualAdjustService.getRescuePreview(rollId!),
    enabled: open,
    staleTime: 0,
  });
  const data = previewQ.data?.data ?? null;

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => manualAdjustService.rescueStuck(rollId!, reason.trim()),
    onSuccess: () => {
      toast.success("Top istasyondan kurtarıldı ve depoya alındı.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      onRescued?.();
      onOpenChange(false);
    },
  });

  const canSubmit =
    Boolean(data?.eligible) && reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" /> İstasyondan Kurtar
          </DialogTitle>
          <DialogDescription>
            Makinede/istasyonda takılı topu depoya (WAREHOUSE) al. Zorunlu sebep (audit).
          </DialogDescription>
        </DialogHeader>

        {previewQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : previewQ.isError ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
            Bağlam alınamadı: {(previewQ.error as Error).message}
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">{data.itemName}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Mevcut durum:</span>
                <Badge variant="muted">{statusLabel(data.currentStatus)}</Badge>
                {data.stationName && <span>· {data.stationName}</span>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Açık istasyon hareketi: {data.openMovementCount}
              </div>
            </div>

            {!data.eligible ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {data.blockReasons.length > 0 ? (
                    data.blockReasons.map((r) => <div key={r}>{r}</div>)
                  ) : (
                    <div>Bu top kurtarma için uygun değil.</div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {data.willGenerateBarcode && (
                  <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50/50 p-3 text-xs text-sky-800">
                    <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Bu top barkodsuz — kurtarmada yeni etiket üretilip basılacak.</span>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="rescue-reason">İşlem Nedeni (zorunlu)</Label>
                  <Input
                    id="rescue-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Örn. makinede takılı kaldı, depoya alındı"
                    maxLength={500}
                  />
                </div>
              </>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "..." : "Kurtar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
