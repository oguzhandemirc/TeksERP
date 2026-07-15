import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StepRollItem } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** dispatch = "Sevk Et"; transfer = "Sonraki Fasona Aktar" (yapısal uyarı gösterir). */
  mode: "dispatch" | "transfer";
  /** Önceden filtrelenmiş toplar (bekleyen / fasonda). */
  rolls: StepRollItem[];
  /** Hedef: firma adı (dispatch) ya da sonraki istasyon (transfer). */
  destinationName: string;
  confirmLabel: string;
  isPending: boolean;
  onConfirm: (rollIds: string[]) => void;
}

/**
 * Fason adımı top seçim modalı — "Sevk Et" / "Sonraki Fasona Aktar" için ortak.
 * Varsayılan TÜM toplar seçili; operatör çıkarabilir ("2 top / 5 top"). DirectShipModal
 * deseninin sadeleştirilmiş hali (Set seçim + tümünü seç + kaydırılır liste).
 */
export function FasonStepRollSelectModal({
  open,
  onOpenChange,
  title,
  mode,
  rolls,
  destinationName,
  confirmLabel,
  isPending,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rollIdsKey = rolls.map((r) => r.id).join(",");

  // Açılışta (veya top kümesi değişince) tümünü seç.
  useEffect(() => {
    if (open) setSelected(new Set(rolls.map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rollIdsKey]);

  const total = rolls.length;
  const selectedCount = selected.size;
  const allSelected = total > 0 && selectedCount === total;
  const selectedMeters = useMemo(
    () => rolls.reduce((s, r) => (selected.has(r.id) ? s + r.currentQty : s), 0),
    [rolls, selected],
  );

  const toggleRoll = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Seçilen toplar <span className="font-medium text-foreground">{destinationName}</span>
            {mode === "dispatch" ? "'a sevk edilecek." : "'a aktarılacak."}
          </p>
          {mode === "transfer" && (
            <p className="inline-flex items-start gap-1 text-[11px] text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Mevcut toplar kapatılıp doğan toplar {destinationName}'a sevk edilir; geri alma iki adımlı.
            </p>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Toplar ({selectedCount}/{total})
            </span>
            <button
              type="button"
              className="text-[11px] font-medium text-primary hover:underline"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(rolls.map((r) => r.id)))
              }
            >
              {allSelected ? "Hiçbirini" : "Tümünü seç"}
            </button>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
            {rolls.map((r) => {
              const on = selected.has(r.id);
              return (
                <li
                  key={r.id}
                  className={cn(
                    "flex items-center gap-2 rounded px-1 py-0.5 text-xs",
                    !on && "opacity-50",
                  )}
                >
                  <Checkbox checked={on} onCheckedChange={(v) => toggleRoll(r.id, Boolean(v))} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                    {r.batchNumber && (
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {r.batchNumber}
                      </Badge>
                    )}
                    {r.item && <span className="truncate text-muted-foreground">{r.item.name}</span>}
                    {r.color && (
                      <Badge variant="muted" className="text-[10px]">
                        {r.color.name}
                      </Badge>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatNumber(r.currentQty, 0)} m
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="shrink-0 items-center justify-between border-t bg-background px-5 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {selectedCount} parça · {formatNumber(selectedMeters, 0)} m
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              disabled={selectedCount === 0 || isPending}
              onClick={() => onConfirm([...selected])}
            >
              {isPending ? "..." : `${confirmLabel} (${selectedCount})`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
