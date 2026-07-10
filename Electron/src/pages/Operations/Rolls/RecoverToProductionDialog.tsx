import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackageOpen, AlertTriangle } from "lucide-react";
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
import { manualAdjustService, type RecoveryTarget } from "./manualAdjustService";

interface Props {
  /** Geri alınacak topun id'si — null = kapalı. */
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Başarılı kurtarmadan sonra (detay panelini tazelemek için). */
  onRecovered?: () => void;
}

/**
 * "Üretime Geri Al" — ham stokta takılı açık kumaşı (fason son-adım dönüşü)
 * uygun bir açık iş emrinin Tambur adımına geri alır. Süpervizör aksiyonu
 * (roll:manual-adjust); zorunlu sebep + audit. Backend orphan'ı yerinde claim
 * eder, sonrasında normal Tambur kesim akışı çalışır.
 */
export function RecoverToProductionDialog({ rollId, onOpenChange, onRecovered }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();
  const [stepId, setStepId] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const targetsQuery = useQuery({
    queryKey: ["recovery-targets", rollId],
    queryFn: () => manualAdjustService.getRecoveryTargets(rollId!),
    enabled: open,
    staleTime: 0,
  });
  const data = targetsQuery.data?.data ?? null;
  const targets: RecoveryTarget[] = data?.eligibleTargets ?? [];

  // Dialog açılınca / hedefler gelince ilk hedefi otomatik seç, formu sıfırla.
  useEffect(() => {
    if (!open) {
      setStepId("");
      setReason("");
    }
  }, [open]);
  useEffect(() => {
    const first = targets[0];
    if (first && !stepId) setStepId(first.stepId);
  }, [targets, stepId]);

  const mutation = useMutation({
    mutationFn: () =>
      manualAdjustService.recoverToProduction(rollId!, { stepId, reason: reason.trim() }),
    onSuccess: () => {
      toast.success("Açık kumaş üretime (Tambur) geri alındı");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      onRecovered?.();
      onOpenChange(false);
    },
  });

  const canSubmit =
    Boolean(stepId) && reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-4 w-4" /> Üretime Geri Al
          </DialogTitle>
          <DialogDescription>
            Ham stokta takılı açık kumaşı uygun bir iş emrinin Tambur adımına geri al.
            Top orada kesilebilir hale gelir.
          </DialogDescription>
        </DialogHeader>

        {targetsQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : targetsQuery.isError ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
            Bağlam alınamadı: {(targetsQuery.error as Error).message}
          </div>
        ) : data && !data.eligible ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{data.reason ?? "Bu top üretime geri alınamaz."}</span>
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">{data.roll.itemName}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {data.roll.currentQty.toLocaleString("tr-TR", { useGrouping: false })} m · {data.roll.qualityGrade}
              </div>
            </div>

            {targets.length === 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {data.warnings[0] ??
                    "Bu ürüne uygun açık (Tambur'lu) iş emri yok — önce hedef ürünle Tambur'lu bir iş emri açın."}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Hedef İş Emri (Tambur)</Label>
                <div className="space-y-1.5">
                  {targets.map((t) => {
                    const selected = t.stepId === stepId;
                    return (
                      <button
                        key={t.stepId}
                        type="button"
                        onClick={() => setStepId(t.stepId)}
                        className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          selected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <span className="font-mono text-xs">{t.batchNumber}</span>
                        <Badge variant="muted" className="text-[10px]">
                          {t.stationName}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="recover-reason">İşlem Nedeni (zorunlu)</Label>
              <Input
                id="recover-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Örn. saha: takılı açık kumaş üretime alındı"
                maxLength={500}
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "..." : "Üretime Al"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
