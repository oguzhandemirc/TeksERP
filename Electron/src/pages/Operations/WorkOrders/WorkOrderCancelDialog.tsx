import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatNumber } from "@/lib/format";
import { workOrderService, type CancelDisposition } from "./service";
import {
  buildCancelDispositions,
  CANCEL_REASON_PRESETS,
  applyBulkChoice,
  formatSummary,
  MIN_REASON_LENGTH,
  summarizeChoices,
  type CancelChoices,
} from "./cancelDecisions";
import { WorkOrderCancelDispatchPanel } from "./WorkOrderCancelDispatchPanel";
import { WorkOrderCancelRollList } from "./WorkOrderCancelRollList";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string | null;
  batchNumber?: string;
  onCancelled?: () => void;
  /** Fason engelinde "Kapat'a geç" — kapatma dialogunu açar. */
  onSwitchToClose?: () => void;
}

export function WorkOrderCancelDialog({
  open,
  onOpenChange,
  workOrderId,
  batchNumber,
  onCancelled,
  onSwitchToClose,
}: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canAdjustRolls = hasPermission("roll:manual-adjust");

  const [choices, setChoices] = useState<CancelChoices>({});
  const [reason, setReason] = useState("");
  /**
   * Fasondaki toplar için TEK karar (2026-08-17). Eskiden fason varsa iptal
   * tamamen engelleniyordu ve kullanıcı çıkışsız kalıyordu — sahadaki
   * "iptal etmek çok zor" şikâyetinin kaynağı buydu. Artık iki düğme.
   */
  const [fasonAction, setFasonAction] = useState<"RETURN_TO_STOCK" | "SCRAP" | null>(null);

  useEffect(() => {
    if (!open) return;
    setChoices({});
    setReason("");
    setFasonAction(null);
  }, [open, workOrderId]);

  const impactQ = useQuery({
    queryKey: ["work-order-cancel-impact", workOrderId],
    queryFn: () => workOrderService.getCancelImpact(workOrderId as string),
    enabled: open && Boolean(workOrderId),
    staleTime: 0,
    gcTime: 0,
  });
  const impact = impactQ.data?.data;

  const rolls = useMemo(() => impact?.rolls ?? [], [impact]);
  const summary = useMemo(() => summarizeChoices(rolls, choices), [rolls, choices]);
  const dispositions = useMemo(() => buildCancelDispositions(rolls, choices), [rolls, choices]);
  const needsAdjust = dispositions.length > 0;

  const cancelMut = useMutation({
    mutationFn: () =>
      workOrderService.cancelWithDecisions(workOrderId as string, {
        reason: reason.trim(),
        ...(dispositions.length > 0 ? { dispositions } : {}),
        ...(fasonAction ? { fasonAction } : {}),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "İş emri iptal edildi");
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      if (workOrderId) {
        void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
        void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      }
      onCancelled?.();
      onOpenChange(false);
    },
  });

  const pending = cancelMut.isPending;
  const fasonCount = impact?.fasonInFlightCount ?? 0;
  // FİRE kararı envanteri yok eder → süpervizör yetkisi (backend de arar).
  const needsAdjustForFason = fasonAction === "SCRAP";
  const canSubmit =
    Boolean(impact?.canCancel) &&
    !pending &&
    reason.trim().length >= MIN_REASON_LENGTH &&
    // Fasonda top varsa karar ZORUNLU — backend kararsız isteği reddediyor,
    // düğmeyi burada da kapatmak kullanıcıyı gereksiz bir hataya sokmuyor.
    (fasonCount === 0 || fasonAction !== null) &&
    (!needsAdjust || canAdjustRolls) &&
    (!needsAdjustForFason || canAdjustRolls);

  const setChoice = (rollId: string, action: CancelDisposition) =>
    setChoices((prev) => ({ ...prev, [rollId]: action }));

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[88vh] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            İş emrini iptal et
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{batchNumber ?? "İş emri"}</span> · geri alınamaz
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {impactQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : impactQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive">Önizleme yüklenemedi.</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void impactQ.refetch()}
              >
                Yeniden Dene
              </Button>
            </div>
          ) : impact ? (
            <>
              {/* Durum özeti — TEK SATIR. */}
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                {impact.rollCount} top · {impact.travelerCardCount} refakat kartı geçersiz olacak
                {impact.processedCount > 0 && ` · ${impact.processedCount} işlenmiş`}
                {impact.rollsTruncated && " · liste ilk 200"}
              </div>

              {/* FASONDAKİ TOPLAR — iki düğme, tek karar (2026-08-17).
                  Metin bilinçli KISA: saha kullanıcısı paragraf okumuyor,
                  düğme arıyor. Karar TOPLU verilir; 40 top için 40 seçim yok. */}
              {fasonCount > 0 && (
                <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                  <div className="text-sm font-medium">
                    {fasonCount} top fasonda. Ne yapılsın?
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={fasonAction === "RETURN_TO_STOCK" ? "default" : "outline"}
                      className="h-auto justify-start whitespace-normal py-2 text-left"
                      onClick={() => setFasonAction("RETURN_TO_STOCK")}
                    >
                      <div>
                        <div className="font-medium">Ham stoğa geri al</div>
                        <div className="text-xs opacity-80">Açık sevkler iptal edilir</div>
                      </div>
                    </Button>
                    <Button
                      type="button"
                      variant={fasonAction === "SCRAP" ? "destructive" : "outline"}
                      className="h-auto justify-start whitespace-normal py-2 text-left"
                      disabled={!canAdjustRolls}
                      onClick={() => setFasonAction("SCRAP")}
                      title={canAdjustRolls ? undefined : "'roll:manual-adjust' yetkisi gerekli"}
                    >
                      <div>
                        <div className="font-medium">Fire yaz</div>
                        <div className="text-xs opacity-80">Mal kullanılamaz</div>
                      </div>
                    </Button>
                  </div>
                </div>
              )}

              {/* Engel + çıkış yolu. */}
              {!impact.canCancel && (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <div>{impact.blockReason}</div>
                  {impact.canSwitchToClose && onSwitchToClose && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => {
                        onOpenChange(false);
                        onSwitchToClose();
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Bunun yerine kapat
                    </Button>
                  )}
                </div>
              )}

              {/* Fasondaki mal — engelin çözüm yüzeyi. */}
              <WorkOrderCancelDispatchPanel
                dispatches={impact.openDispatches ?? []}
                onCancelled={() => void impactQ.refetch()}
              />

              {/* Parti kırılımı — tek parti düşürmek isteyen buradan görür. */}
              {(impact.batches?.length ?? 0) > 1 && (
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {impact.batches.map((b) => (
                    <span
                      key={b.batchId}
                      className="rounded border px-1.5 py-0.5 text-muted-foreground"
                      title={b.locked ? "Fasonda top / açık sevk var" : undefined}
                    >
                      {b.batchNumber} · {b.liveRollCount} top · {formatNumber(b.meters)} m
                      {b.locked && " 🔒"}
                    </span>
                  ))}
                </div>
              )}

              {impact.canCancel && (
                <>
                  <WorkOrderCancelRollList
                    rolls={rolls}
                    choices={choices}
                    disabled={pending}
                    onChange={setChoice}
                    onBulk={(action) =>
                      setChoices((prev) => applyBulkChoice(rolls, action, prev))
                    }
                  />

                  {needsAdjust && !canAdjustRolls && (
                    <div className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-warning">
                      Fire / hatalı kayıt için `roll:manual-adjust` yetkisi gerekli.
                    </div>
                  )}

                  {/* Gerekçe — hazır seçenek + serbest. */}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium">Gerekçe</span>
                      {CANCEL_REASON_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setReason(p)}
                          className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      placeholder="En az 3 karakter"
                      className="text-xs"
                    />
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between gap-2 border-t bg-background px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">{formatSummary(summary)}</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button variant="destructive" disabled={!canSubmit} onClick={() => cancelMut.mutate()}>
              {pending ? "İptal ediliyor..." : "İptal et"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
