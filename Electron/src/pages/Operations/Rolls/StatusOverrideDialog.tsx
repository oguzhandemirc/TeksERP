import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRightLeft } from "lucide-react";
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
  /** Durumu düzeltilecek topun id'si — null = kapalı. */
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

const statusLabel = (s: RollStatus): string => rollStatusLabels[s] ?? s;

/**
 * "Durum Düzelt" — süpervizör manuel durum düzeltme (roll:manual-adjust).
 * Yalnız güvenli whitelist (WAREHOUSE↔STOCK, PRODUCED→WAREHOUSE). Sevk/çuval/
 * istasyon/fason bağı varsa backend engeller (blockReasons). Zorunlu sebep (audit).
 */
export function StatusOverrideDialog({ rollId, onOpenChange, onChanged }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const previewQ = useQuery({
    queryKey: ["status-override-preview", rollId],
    queryFn: () => manualAdjustService.getStatusOverridePreview(rollId!),
    enabled: open,
    staleTime: 0,
  });
  const data = previewQ.data?.data ?? null;
  const targets = useMemo(() => data?.allowedTargets ?? [], [data?.allowedTargets]);

  useEffect(() => {
    if (!open) {
      setTarget("");
      setReason("");
    }
  }, [open]);
  useEffect(() => {
    const first = targets[0];
    if (first && !target) setTarget(first);
  }, [targets, target]);

  const mut = useMutation({
    mutationFn: () =>
      manualAdjustService.manualStatus(rollId!, {
        targetStatus: target as RollStatus,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success("Top durumu güncellendi.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      onChanged?.();
      onOpenChange(false);
    },
  });

  const canSave = Boolean(target) && reason.trim().length >= 3 && !mut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" /> Durum Düzelt
          </DialogTitle>
          <DialogDescription>
            Topun durumunu manuel düzelt — yalnız güvenli geçişler. Zorunlu sebep (audit).
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
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Mevcut durum:</span>
              <Badge variant="muted">{statusLabel(data.currentStatus)}</Badge>
            </div>

            {data.blockReasons.length > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {data.blockReasons.map((r) => (
                    <div key={r}>{r}</div>
                  ))}
                </div>
              </div>
            ) : targets.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Bu top için manuel durum geçişi tanımlı değil.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Yeni Durum</Label>
                  <div className="flex flex-wrap gap-2">
                    {targets.map((t) => {
                      const selected = t === target;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTarget(t)}
                          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          {statusLabel(t)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="status-override-reason">İşlem Nedeni (zorunlu)</Label>
                  <Input
                    id="status-override-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Örn. depo topu üretime/satışa yeniden yönlendirildi"
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
          <Button disabled={!canSave} onClick={() => mut.mutate()}>
            {mut.isPending ? "..." : "Durumu Değiştir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
