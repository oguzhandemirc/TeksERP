import { Badge } from "@/components/ui/badge";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import { formatNumber } from "@/lib/format";
import type { CompletePreviewRoll } from "./service";

interface Props {
  rolls: (CompletePreviewRoll & { blockReason: string })[];
}

/**
 * Kapatmayı ENGELLEYEN toplar: fasonda ya da açık fason sevkinde. Bunlara kapanışta
 * karar verilemez — mal fiziksel olarak dışarıda, önce fason kabul/iade yapılır.
 */
export function WorkOrderCompleteBlockedRolls({ rolls }: Props) {
  if (rolls.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Kapatmayı engelleyen toplar ({rolls.length})
      </div>
      <ul className="space-y-1 rounded-md border border-destructive/40 p-2">
        {rolls.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-2 text-xs">
            <span className="flex min-w-0 flex-col">
              <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
              <span className="text-[10px] text-destructive">{r.blockReason}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className="text-[10px] text-destructive">
                {rollStatusLabels[r.status as RollStatus] ?? r.status}
              </Badge>
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(r.currentQty, 0)} m
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
