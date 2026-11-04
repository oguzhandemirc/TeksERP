import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Unlink } from "lucide-react";
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
import { formatNumber } from "@/lib/format";
import { workOrderService } from "./service";
import {
  remainingColorSuggestion,
  unlinkRowStates,
  type ColorSuggestion,
  type UnlinkRowState,
} from "./unlink-order-links";
import type { WorkOrder } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Liste satırı da olabilir — bağların tam hâli detay sorgusundan okunur. */
  workOrder: WorkOrder;
  /** Kalan siparişin rengini öneri onaylanınca "Rengi Değiştir"i bu renkle aç. */
  onSuggestColor: (colorId: string) => void;
}

function readApiMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? "İşlem başarısız";
}

/**
 * "Sipariş Bağını Kopar" — bağlı kalemlerden seçilenlerin bağını kaldırır.
 * Hedef kumaş boşken son bağ koparılamaz (backend 400); kalan kalemler tek
 * renkse ve iş emrinin rengi boşsa rengi önerir.
 */
export function UnlinkOrderLinksDialog({ open, onOpenChange, workOrder, onSuggestColor }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestion, setSuggestion] = useState<ColorSuggestion | null>(null);

  // Detay sayfası / paneliyle AYNI anahtar: liste satırının bağları kumaş/renk taşımaz.
  const detail = useQuery({
    queryKey: ["work-order-detail", workOrder.id],
    queryFn: () => workOrderService.getById(workOrder.id),
    enabled: open,
    staleTime: 60_000,
  });
  const wo = detail.data?.data ?? workOrder;
  const links = useMemo(() => wo.orderLinks ?? [], [wo.orderLinks]);

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
      else next.add(id);
      return next;
    });

  const mutation = useUnlinkMutation(wo, links, selected, (removed) => {
    const s = remainingColorSuggestion(links, removed, wo.targetColorId);
    if (s) setSuggestion(s);
    else onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sipariş Bağını Kopar — {wo.workOrderNumber}</DialogTitle>
          <DialogDescription>
            Bağı koparılacak kalemleri seçin. İş emri ve topları değişmez; yalnız sipariş bağı kalkar.
          </DialogDescription>
        </DialogHeader>

        {suggestion ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            Kalan sipariş {suggestion.colorName}; iş emrinin rengi {suggestion.colorName} yapılsın mı?
          </div>
        ) : detail.isLoading && links.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : (
          <UnlinkLinksTable
            links={links}
            selected={selected}
            rowStates={unlinkRowStates(links, selected, wo.targetItemId)}
            pending={mutation.isPending}
            onToggle={toggle}
          />
        )}

        <DialogFooter>
          <UnlinkFooter
            suggestion={suggestion}
            selectedCount={selected.size}
            pending={mutation.isPending}
            onClose={() => onOpenChange(false)}
            onSubmit={() => mutation.mutate()}
            onSuggestColor={onSuggestColor}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Links = NonNullable<WorkOrder["orderLinks"]>;

/** Seçilenleri SIRAYLA koparır; düşen satır uyarıyla söylenir, diğerleri yapılır. */
function useUnlinkMutation(
  wo: WorkOrder,
  links: Links,
  selected: ReadonlySet<string>,
  onRemoved: (removed: Set<string>) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const removed = new Set<string>();
      for (const l of links) {
        if (!selected.has(l.orderLineId)) continue;
        const orderNo = l.orderLine?.order?.orderNumber ?? "sipariş";
        try {
          await workOrderService.unlinkOrderLine(wo.id, l.orderLineId);
          removed.add(l.orderLineId);
        } catch (err) {
          toast.warning(`${orderNo}: ${readApiMessage(err)}`);
        }
      }
      return removed;
    },
    onSuccess: (removed) => {
      // ⚠️ Anahtarlar ekranların kullandığıyla birebir (ChangeTargetDialog ile aynı küme).
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", wo.id] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", wo.id] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      if (removed.size === 0) return;
      toast.success(`${removed.size} sipariş bağı koparıldı`);
      onRemoved(removed);
    },
  });
}

function UnlinkLinksTable({
  links,
  selected,
  rowStates,
  pending,
  onToggle,
}: {
  links: Links;
  selected: ReadonlySet<string>;
  rowStates: Record<string, UnlinkRowState>;
  pending: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-8 p-2" />
            <th className="p-2">Sipariş No</th>
            <th className="p-2">Müşteri</th>
            <th className="p-2">Kumaş</th>
            <th className="p-2">Renk</th>
            <th className="p-2 text-right">Miktar</th>
          </tr>
        </thead>
        <tbody>
          {links.map((l) => {
            const ol = l.orderLine;
            const st = rowStates[l.orderLineId];
            return (
              <tr key={l.orderLineId} className={st?.disabled ? "opacity-60" : undefined}>
                <td className="p-2 align-top">
                  <Checkbox
                    checked={selected.has(l.orderLineId)}
                    disabled={st?.disabled || pending}
                    onCheckedChange={() => onToggle(l.orderLineId)}
                    aria-label={`${ol?.order?.orderNumber ?? "Kalem"} seç`}
                  />
                </td>
                <td className="p-2 align-top">
                  <div className="font-mono text-xs">{ol?.order?.orderNumber ?? "—"}</div>
                  {st?.reason && <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">{st.reason}</div>}
                </td>
                <td className="p-2 align-top">{ol?.order?.customer?.name ?? "—"}</td>
                <td className="p-2 align-top">{ol?.item?.name ?? "—"}</td>
                <td className="p-2 align-top">{ol?.color?.name ?? "—"}</td>
                <td className="p-2 text-right align-top tabular-nums">
                  {ol ? `${formatNumber(ol.quantity, 1)} ${ol.unit ?? "MT"}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UnlinkFooter({
  suggestion,
  selectedCount,
  pending,
  onClose,
  onSubmit,
  onSuggestColor,
}: {
  suggestion: ColorSuggestion | null;
  selectedCount: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onSuggestColor: (colorId: string) => void;
}) {
  if (suggestion) {
    return (
      <>
        <Button variant="outline" onClick={onClose}>
          Hayır
        </Button>
        <Button
          onClick={() => {
            const colorId = suggestion.colorId;
            onClose();
            onSuggestColor(colorId);
          }}
        >
          Evet, rengi değiştir
        </Button>
      </>
    );
  }
  return (
    <>
      <Button variant="outline" onClick={onClose} disabled={pending}>
        Vazgeç
      </Button>
      <Button variant="destructive" disabled={selectedCount === 0 || pending} onClick={onSubmit}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
        Bağı Kopar ({selectedCount})
      </Button>
    </>
  );
}
