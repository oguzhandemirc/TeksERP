import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Unlink } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { unitLabel } from "@/lib/item-unit";
import { TERIM } from "@/lib/terim";
import { workOrderService } from "./service";
import type { WorkOrder } from "./types";
import { LAST_LINK_REASON, isRowLocked, lastLinkLocked, remainingSingleColor, unlinkRows, type UnlinkRow } from "./unlink-order";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wo: WorkOrder;
  /** Öneri onaylanınca: mevcut "Rengi Değiştir" akışını bu renkle önceden doldurulmuş aç. */
  onSuggestColor: (colorId: string) => void;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

/**
 * "Sipariş Bağını Kopar" — bağlı kalemleri listeler, kayıt başına seçim; son-bağ kilidi
 * ÖNCEDEN görünür (backend aynı kuralı 400 ile uygular). Koparma sonrası kalan kalemler
 * tek renkse ve hedef renk boşsa renk önerisi aynı diyalogda sorulur.
 */
export function UnlinkOrderDialog({ open, onOpenChange, wo, onSuggestColor }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestion, setSuggestion] = useState<{ id: string; name: string } | null>(null);
  const rows = useMemo(() => unlinkRows(wo), [wo]);
  const locked = lastLinkLocked(wo);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSuggestion(null);
    }
  }, [open]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (!isRowLocked(id, prev, rows.length, locked)) next.add(id);
      return next;
    });

  const mutation = useUnlinkMutation(wo, (removed) => {
    const next = remainingSingleColor(wo, removed);
    if (next) setSuggestion(next);
    else onOpenChange(false);
  });

  if (suggestion) {
    return <ColorSuggestion open={open} onOpenChange={onOpenChange} color={suggestion} onConfirm={onSuggestColor} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlink className="h-4 w-4" /> Sipariş Bağını Kopar — {wo.workOrderNumber}
          </DialogTitle>
          <DialogDescription>
            Koparılacak kalemleri seçin. Bağ silinmez, koparıldı olarak damgalanır; üretim, rota ve toplar değişmez.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60">
              <tr>
                <th className="w-8 p-2" />
                <th className="p-2 text-left font-medium">Sipariş / Müşteri</th>
                <th className="p-2 text-left font-medium">Kumaş / Renk</th>
                <th className="p-2 text-right font-medium">Miktar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <UnlinkRowItem
                  key={r.orderLineId}
                  row={r}
                  checked={selected.has(r.orderLineId)}
                  disabled={isRowLocked(r.orderLineId, selected, rows.length, locked)}
                  onToggle={() => toggle(r.orderLineId)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={selected.size === 0 || mutation.isPending}
            onClick={() => mutation.mutate([...selected])}
          >
            {mutation.isPending ? "Koparılıyor…" : `Bağı Kopar (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlinkRowItem({
  row: r,
  checked,
  disabled,
  onToggle,
}: {
  row: UnlinkRow;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      aria-disabled={disabled}
      className={disabled ? "border-t opacity-60" : "cursor-pointer border-t hover:bg-accent/40"}
      onClick={onToggle}
    >
      <td className="p-2 align-top" onClick={(e) => e.stopPropagation()}>
        <Checkbox aria-label={`${r.orderNumber} seç`} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      </td>
      <td className="p-2 align-top">
        <div className="font-mono text-xs">{r.orderNumber}</div>
        <div className="text-xs text-muted-foreground">{r.customerName}</div>
        {disabled && <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{LAST_LINK_REASON}</div>}
      </td>
      <td className="p-2 align-top">
        <div>{r.itemName}</div>
        <div className="text-xs text-muted-foreground">{r.colorName ?? "renksiz"}</div>
      </td>
      <td className="p-2 text-right align-top tabular-nums">
        {r.quantity != null ? `${fmt(r.quantity)} ${unitLabel(r.unit)}` : "—"}
      </td>
    </tr>
  );
}

/** Koparma sonrası tek-renk önerisi; "Evet" mevcut "Rengi Değiştir" akışını bu renkle açar. */
function ColorSuggestion({
  open,
  onOpenChange,
  color,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  color: { id: string; name: string };
  onConfirm: (colorId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rengi eşitle</DialogTitle>
          <DialogDescription>
            Kalan sipariş {color.name}; {TERIM.terbiyeIsEmri.cekimKucuk.ilgi} rengi {color.name} yapılsın mı?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Hayır
          </Button>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onConfirm(color.id);
            }}
          >
            Evet, rengi değiştir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Seçilenleri sırayla koparır; en az biri koptuysa sorguları tazeler ve `onRemoved`ı çağırır. */
function useUnlinkMutation(wo: WorkOrder, onRemoved: (removed: Set<string>) => void) {
  const qc = useQueryClient();
  return useMutation({
    // Uç tekil; sırayla koparılır. Düşen satırın hatasını apiClient zaten gösterir (ikinci toast yok).
    mutationFn: async (ids: string[]) => {
      const removed = new Set<string>();
      for (const id of ids) {
        try {
          await workOrderService.unlinkOrderLine(wo.id, id);
          removed.add(id);
        } catch {
          /* apiClient bildirdi; kalanlarla devam */
        }
      }
      return removed;
    },
    onSuccess: (removed) => {
      if (removed.size === 0) return;
      toast.success(`${removed.size} sipariş bağı koparıldı`);
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", wo.id] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", wo.id] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onRemoved(removed);
    },
  });
}
