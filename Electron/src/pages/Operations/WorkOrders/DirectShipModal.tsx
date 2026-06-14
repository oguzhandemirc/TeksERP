import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Truck, AlertTriangle, CheckCircle2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
 * Fasondan Doğrudan Sevk — fason fiilen son durak olduğunda (mal fabrikaya
 * dönmeden müşteriye sevk) açık sevki manuel kapatır: toplar tüketilir, kalan
 * adımlar atlanır, WO tamamlanır. İstenirse hangi sipariş(ler)e gittiği
 * karşılanmaya işlenir (operatör seçer — WO'nun bağlı siparişi olmayabilir).
 */
export function DirectShipModal({ open, onOpenChange, workOrderId, dispatchId, dispatchNo }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  // orderLineId → karşılanan metraj (yalnız seçili satırlar).
  const [alloc, setAlloc] = useState<Record<string, number>>({});

  const previewQ = useQuery({
    queryKey: ["direct-ship-preview", dispatchId],
    queryFn: () => workOrderService.getDirectShipPreview(dispatchId),
    enabled: open && Boolean(dispatchId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  // Modal her açılışta temizlensin (önceki sevkin değerleri taşmasın).
  useEffect(() => {
    if (open) {
      setReason("");
      setAlloc({});
    }
  }, [open, dispatchId]);

  const mut = useMutation({
    mutationFn: () =>
      workOrderService.directShip(dispatchId, {
        reason: reason.trim(),
        orderLineAllocations: Object.entries(alloc)
          .filter(([, qty]) => qty > 0)
          .map(([orderLineId, qty]) => ({ orderLineId, qty })),
      }),
    onSuccess: (res) => {
      toast.success(`Fasondan doğrudan sevk edildi: ${res.data?.dispatchNo ?? dispatchNo}`);
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
    },
  });

  const allocTotal = useMemo(
    () => Object.values(alloc).reduce((s, q) => s + (q > 0 ? q : 0), 0),
    [alloc],
  );
  const canSubmit =
    !!preview &&
    !preview.cancelled &&
    !preview.alreadyDirectShipped &&
    preview.affectedRolls.length > 0 &&
    reason.trim().length >= 3 &&
    !mut.isPending;

  const toggleLine = (id: string, suggested: number, checked: boolean) =>
    setAlloc((prev) => {
      const next = { ...prev };
      if (checked) next[id] = suggested > 0 ? suggested : 0;
      else delete next[id];
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Fasondan Doğrudan Sevk
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{dispatchNo}</span> — mal fasondan bize dönmeden doğrudan
            sevk edildi olarak kapatılır. Bu işlem geri alınamaz.
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
            preview.cancelled || preview.alreadyDirectShipped ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {preview.cancelled
                  ? "Bu sevk iptal edilmiş — doğrudan sevk edilemez."
                  : "Bu sevk zaten doğrudan sevk edilmiş."}
              </div>
            ) : (
              <>
                {/* Ne olacak özeti */}
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="mb-1 font-medium">Bu işlem şunları yapacak:</div>
                  <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">{preview.affectedRolls.length}</span>{" "}
                      top tüketilecek (fasonda kapanır)
                    </li>
                    {preview.downstreamStepsToSkip.length > 0 && (
                      <li>
                        Sonraki{" "}
                        <span className="font-medium text-foreground">
                          {preview.downstreamStepsToSkip.length}
                        </span>{" "}
                        adım atlanacak:{" "}
                        {preview.downstreamStepsToSkip.map((s) => s.stationName).join(", ")}
                      </li>
                    )}
                    <li>
                      {preview.woWillComplete ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> İş emri TAMAMLANACAK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" /> İş emri açık kalacak (bu adımda{" "}
                          {preview.otherAtSubcontractor} top daha fasonda)
                        </span>
                      )}
                    </li>
                  </ul>
                </div>

                {/* Etkilenecek toplar */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Sevk edilecek toplar ({preview.affectedRolls.length})
                  </div>
                  <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                    {preview.affectedRolls.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5">
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

                {/* Sebep */}
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="ds-reason">
                    Sebep <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="ds-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Örn. Boyahane malı doğrudan müşteriye sevk etti"
                    className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Opsiyonel karşılanma */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Hangi siparişe gitti? (opsiyonel — karşılanmaya işlenir)
                  </div>
                  {preview.candidateOrderLines.length === 0 ? (
                    <div className="rounded-md border border-dashed p-2 text-center text-xs italic text-muted-foreground">
                      Eşleşen açık sipariş satırı yok. Boş bırakılırsa yalnız WO kapanır.
                    </div>
                  ) : (
                    <ul className="space-y-1 rounded-md border p-2">
                      {preview.candidateOrderLines.map((l) => {
                        const checked = l.orderLineId in alloc;
                        return (
                          <li key={l.orderLineId} className="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                toggleLine(l.orderLineId, l.suggestedQty, Boolean(v))
                              }
                            />
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span className="font-mono">{l.orderNumber}</span>
                              {l.isWorkOrderLinked && (
                                <Badge variant="outline" className="text-[10px]">
                                  WO
                                </Badge>
                              )}
                              <span className="truncate text-muted-foreground">
                                {l.itemName}
                                {l.colorName ? ` · ${l.colorName}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              kalan {formatNumber(l.remaining, 0)} m
                            </span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              disabled={!checked}
                              value={checked ? alloc[l.orderLineId] : ""}
                              onChange={(e) =>
                                setAlloc((prev) => ({
                                  ...prev,
                                  [l.orderLineId]: Math.max(0, Number(e.target.value) || 0),
                                }))
                              }
                              className="w-20 rounded-md border bg-background px-2 py-1 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {allocTotal > 0 && (
                    <div className="mt-1 text-right text-[11px] text-muted-foreground">
                      Toplam karşılanan: {formatNumber(allocTotal, 0)} m
                    </div>
                  )}
                </div>
              </>
            )
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canSubmit} onClick={() => mut.mutate()}>
            {mut.isPending ? "Sevk ediliyor..." : "Doğrudan Sevk Et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
