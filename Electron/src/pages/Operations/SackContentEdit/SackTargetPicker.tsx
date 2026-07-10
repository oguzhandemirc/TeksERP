import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { packingService } from "./service";
import { invalidateShipmentData } from "./useShipmentDetail";
import type { ShipmentSack } from "./types";

const fmtKg = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface MoveTarget {
  rollId: string;
  rollLabel: string;
  fromSackId: string | null;
}

interface Props {
  shipmentId: string;
  target: MoveTarget | null;
  sacks: ShipmentSack[];
  onOpenChange: (open: boolean) => void;
}

/**
 * "Taşı" hedef-çuval seçici — topu aynı sevkiyattaki BAŞKA bir çuvala taşır.
 * Kaynak çuval listeden çıkarılır; başka çuval yoksa uyarı gösterir.
 */
export function SackTargetPicker({ shipmentId, target, sacks, onOpenChange }: Props) {
  const qc = useQueryClient();
  const open = !!target;
  const candidates = sacks.filter((s) => s.id !== target?.fromSackId);

  const mut = useMutation({
    mutationFn: (sackId: string) => packingService.moveRollToSack(target!.rollId, sackId),
    onSuccess: (_res, sackId) => {
      const dest = sacks.find((s) => s.id === sackId);
      toast.success(`Çuval #${dest?.seq ?? "?"}'e taşındı`);
      invalidateShipmentData(qc, shipmentId);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" /> Topu Taşı
          </DialogTitle>
          <DialogDescription className="truncate font-mono">{target?.rollLabel}</DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Taşınacak başka çuval yok — önce bir çuval açın.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {candidates.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={mut.isPending}
                  onClick={() => mut.mutate(s.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" /> Çuval #{s.seq}
                    {s.manualCode && (
                      <span className="font-mono text-xs text-muted-foreground">({s.manualCode})</span>
                    )}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {s.rollCount} top
                    {s.weightKg != null ? ` · ${fmtKg(s.weightKg)} kg` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type { MoveTarget };
