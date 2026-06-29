import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2, AlertTriangle, ArrowLeft } from "lucide-react";
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
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { workOrderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  dispatchId: string;
  dispatchNo: string;
}

/**
 * Aktarımı Geri Al — yanlışlıkla sonraki fasona aktarılan malı geri sarar. Boyahane
 * sevki + kaynak kabul atomik iptal edilir; born toplar CANCELLED'a çekilir,
 * orijinaller kaynak fasona (ör. zımpara) AT_SUBCONTRACTOR olarak geri döner.
 * Yalnız boyahane HENÜZ kabul/işlem YAPMADIYSA uygundur (backend preview doğrular).
 */
export function UndoTransferModal({ open, onOpenChange, workOrderId, dispatchId, dispatchNo }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const previewQ = useQuery({
    queryKey: ["undo-transfer-preview", dispatchId],
    queryFn: () => workOrderService.getUndoTransferPreview(dispatchId),
    enabled: open && Boolean(dispatchId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  useEffect(() => {
    if (open) setReason("");
  }, [open, dispatchId]);

  const mut = useMutation({
    mutationFn: () => workOrderService.undoTransfer(dispatchId, reason.trim()),
    onSuccess: (res) => {
      toast.success(`Aktarım geri alındı: ${res.data?.dispatchNo ?? dispatchNo}`);
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
    },
  });

  const canSubmit =
    !!preview && preview.safe && reason.trim().length >= 3 && !mut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-primary" />
            Aktarımı Geri Al
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{dispatchNo}</span> — bu sonraki fason sevkini iptal eder ve
            malı kaynak fasona geri alır.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {previewQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : previewQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <div className="font-medium text-destructive">
                Önizleme yüklenemedi — görmeden onaylanamaz.
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
            <>
              {!preview.safe && (
                <Callout tone="danger">
                  Bu aktarım geri alınamaz:
                  <ul className="mt-1 list-disc pl-4">
                    {preview.blockingReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </Callout>
              )}

              {preview.safe && (
                <Callout tone="warning">
                  <span className="font-medium">{preview.targetStationName}</span> sevki iptal
                  edilecek ve mal{" "}
                  <span className="font-medium">{preview.sourceStationName ?? "kaynak fason"}</span>'a
                  geri dönecek. Bu adımdaki açık kumaş toplar iptal edilir; kaynak orijinaller fasonda
                  bekler hale gelir.
                </Callout>
              )}

              {/* İptal edilecek born toplar */}
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  İptal edilecek toplar ({preview.bornRolls.length}) — {preview.targetStationName}
                </div>
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                  {preview.bornRolls.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                        <span className="truncate text-muted-foreground">{r.itemName}</span>
                        {r.colorName && (
                          <Badge variant="muted" className="text-[10px]">
                            {r.colorName}
                          </Badge>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatNumber(r.currentQty, 0)} m
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Geri dönecek kaynak orijinaller */}
              {preview.sourceReceipts.map((sr) => (
                <div key={sr.id}>
                  <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <ArrowLeft className="h-3 w-3" />
                    Geri dönecek toplar ({sr.originalRolls.length}) — {sr.stationName ?? "kaynak fason"}
                    <span className="font-mono normal-case opacity-70">· {sr.receiptNo} iptal</span>
                  </div>
                  <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                    {sr.originalRolls.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-xs">
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="font-mono">{r.barcode ?? "—"}</span>
                          <span className="truncate text-muted-foreground">{r.itemName}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatNumber(r.currentQty, 0)} m
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* Sebep */}
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="undo-reason">
                  Sebep <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="undo-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  disabled={!preview.safe}
                  placeholder="Örn. Yanlışlıkla boyahaneye aktarıldı, zımparaya geri alınıyor"
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canSubmit} onClick={() => mut.mutate()}>
            {mut.isPending ? (
              "Geri alınıyor..."
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Aktarımı Geri Al
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
