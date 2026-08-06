import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { workOrderService, type CancelImpactDispatch } from "./service";

interface Props {
  dispatches: CancelImpactDispatch[];
  /** İptal başarılı olunca etki önizlemesi tazelensin. */
  onCancelled: () => void;
}

/**
 * Açık fason sevkleri — iptalin ÖNÜNDEKİ engelin çözüm yüzeyi.
 *
 * Buradan önce kullanıcı her partiye tek tek gidip sevkini iptal etmek zorundaydı
 * (K10: bir sevk = bir parti, yani N parti = N ekran). Panel aynı işi tek onaya
 * indirir. Sonuç PARÇALI olabilir: iptal edilemeyen sevkler somut sebebiyle döner.
 */
export function WorkOrderCancelDispatchPanel({ dispatches, onCancelled }: Props) {
  const [reason, setReason] = useState("");
  const cancellable = dispatches.filter((d) => d.cancellable);

  const bulkMut = useMutation({
    mutationFn: () =>
      workOrderService.cancelFasonDispatchBulk(
        cancellable.map((d) => d.dispatchId),
        reason.trim(),
      ),
    onSuccess: (res) => {
      const failed = res.data?.failed ?? [];
      if (failed.length > 0) {
        // "N iptal edildi" deyip atlananları yutmak en kötü davranış — her satır
        // kendi sebebiyle gösterilir.
        toast.warning(res.message ?? "Kısmi iptal", {
          description: failed.map((f) => `${f.dispatchNo ?? "?"}: ${f.message}`).join("\n"),
        });
      } else {
        toast.success(res.message ?? "Sevkler iptal edildi");
      }
      setReason("");
      onCancelled();
    },
  });

  if (dispatches.length === 0) return null;
  const totalRolls = dispatches.reduce((s, d) => s + d.rollCount, 0);

  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        {dispatches.length} açık fason sevki · {totalRolls} top dışarıda
      </div>

      <ul className="space-y-1">
        {dispatches.map((d) => (
          <li
            key={d.dispatchId}
            className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-mono">{d.dispatchNo}</span>
              <span className="truncate text-muted-foreground">
                {d.subcontractorName}
                {d.batchNumber ? ` · ${d.batchNumber}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
              {d.rollCount} top · {formatNumber(d.totalQty)} m
              {!d.cancellable && (
                <span className="text-destructive" title={d.blockReason ?? undefined}>
                  iptal edilemez
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {cancellable.length > 0 ? (
        <div className="flex items-center gap-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="İptal sebebi (en az 3 karakter)"
            maxLength={500}
            className="h-7 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 shrink-0 text-xs"
            disabled={reason.trim().length < 3 || bulkMut.isPending}
            onClick={() => bulkMut.mutate()}
          >
            {bulkMut.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Sevkleri iptal et ({cancellable.length})
          </Button>
        </div>
      ) : (
        <div className="text-muted-foreground">
          Sevkler buradan iptal edilemiyor — önce mal kabulü geri alınmalı.
        </div>
      )}
    </div>
  );
}
