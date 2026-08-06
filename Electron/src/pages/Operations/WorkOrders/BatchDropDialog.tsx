import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatNumber } from "@/lib/format";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import { workOrderService, type CancelDisposition } from "./service";
import {
  CANCEL_OPTIONS,
  CANCEL_REASON_PRESETS,
  formatSummary,
  MIN_REASON_LENGTH,
} from "./cancelDecisions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  batchId: string | null;
  /** Partide top kalmayınca "iş emrini de iptal et" teklifini açar. */
  onWorkOrderEmpty?: () => void;
}

/**
 * PARTİYİ DÜŞÜR — iş emri diğer partileriyle DEVAM eder.
 *
 * İptalle aynı karar dili (ham stok / fire / hatalı kayıt), farklı kapsam. "Ham
 * stok" seçilen RENKLİ top ham stoğa değil kaliteden çözülen rafa döner; önizleme
 * bunu satır başına `revertStatus` ile söyler — etiketin yalan söylememesi için.
 */
export function BatchDropDialog({
  open,
  onOpenChange,
  workOrderId,
  batchId,
  onWorkOrderEmpty,
}: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canAdjustRolls = hasPermission("roll:manual-adjust");

  const [choices, setChoices] = useState<Record<string, CancelDisposition>>({});
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setChoices({});
    setReason("");
  }, [open, batchId]);

  const previewQ = useQuery({
    queryKey: ["batch-drop-preview", workOrderId, batchId],
    queryFn: () => workOrderService.getBatchDropPreview(workOrderId, batchId as string),
    enabled: open && Boolean(batchId),
    staleTime: 0,
    gcTime: 0,
  });
  const preview = previewQ.data?.data;
  const rolls = useMemo(() => preview?.rolls ?? [], [preview]);

  const dispositions = useMemo(
    () =>
      rolls
        .map((r) => ({ rollId: r.id, action: choices[r.id] ?? ("STOCK" as CancelDisposition) }))
        // STOCK gönderilmez — backend'deki ikiziyle aynı kural (bkz. cancelDecisions).
        .filter((d) => d.action !== "STOCK"),
    [rolls, choices],
  );
  const summary = useMemo(() => {
    let stock = 0;
    let scrap = 0;
    let cancelled = 0;
    for (const r of rolls) {
      const a = choices[r.id] ?? "STOCK";
      if (a === "SCRAP") scrap += 1;
      else if (a === "CANCELLED") cancelled += 1;
      else stock += 1;
    }
    return { stock, scrap, cancelled };
  }, [rolls, choices]);

  const dropMut = useMutation({
    mutationFn: () =>
      workOrderService.dropBatch(workOrderId, batchId as string, {
        reason: reason.trim(),
        ...(dispositions.length > 0 ? { dispositions } : {}),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Parti düşürüldü");
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      onOpenChange(false);
      if (res.data?.noLiveRollsRemain) onWorkOrderEmpty?.();
    },
  });

  const pending = dropMut.isPending;
  const needsAdjust = dispositions.length > 0;
  const canSubmit =
    Boolean(preview?.canDrop) &&
    !pending &&
    reason.trim().length >= MIN_REASON_LENGTH &&
    (!needsAdjust || canAdjustRolls);

  return (
    <Dialog open={open} onOpenChange={(n) => !pending && onOpenChange(n)}>
      <DialogContent className="flex max-h-[88vh] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Partiyi düşür
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{preview?.batchNumber ?? "Parti"}</span> · iş emri devam
            eder
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {previewQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : previewQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive">Önizleme yüklenemedi.</div>
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
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                {preview.rollCount} top · {formatNumber(preview.totalMeters)} m
                {preview.otherBatches.length > 0
                  ? ` · iş emrinde ${preview.otherBatches.length} parti daha kalır`
                  : " · iş emrinde başka parti yok"}
              </div>

              {!preview.canDrop && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  {preview.blockReason}
                </div>
              )}

              {preview.canDrop && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">Toplar</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Hepsine:</span>
                      {CANCEL_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            setChoices((prev) => {
                              const next = { ...prev };
                              for (const r of rolls) {
                                if (o.value === "STOCK" && !r.canReturnToStock) continue;
                                next[r.id] = o.value;
                              }
                              return next;
                            })
                          }
                          className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                    {rolls.map((r) => {
                      const action = choices[r.id] ?? "STOCK";
                      return (
                        <div
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
                            <span className="tabular-nums text-muted-foreground">
                              {formatNumber(r.currentQty)} m
                            </span>
                            {/* Etiket "Ham stok" derken topun depoya gitmesi yanıltıcı
                                olurdu — gerçek hedef burada yazılı. */}
                            {action === "STOCK" && r.revertStatus !== "STOCK" && (
                              <span className="text-[10px] text-muted-foreground">
                                → {rollStatusLabels[r.revertStatus as RollStatus] ?? r.revertStatus}
                              </span>
                            )}
                          </span>
                          <Select
                            value={action}
                            disabled={pending}
                            onValueChange={(v) =>
                              setChoices((p) => ({ ...p, [r.id]: v as CancelDisposition }))
                            }
                          >
                            <SelectTrigger className="h-7 w-36 shrink-0 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CANCEL_OPTIONS.map((o) => (
                                <SelectItem
                                  key={o.value}
                                  value={o.value}
                                  disabled={o.value === "STOCK" && !r.canReturnToStock}
                                  className="text-xs"
                                >
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>

                  {needsAdjust && !canAdjustRolls && (
                    <div className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-warning">
                      Fire / hatalı kayıt için `roll:manual-adjust` yetkisi gerekli.
                    </div>
                  )}

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
            <Button variant="destructive" disabled={!canSubmit} onClick={() => dropMut.mutate()}>
              {pending ? "Düşürülüyor..." : "Partiyi düşür"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
