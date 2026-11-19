import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Split } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { showServerWarnings, toastServerSuccess } from "@/lib/serverNotes";
import { workOrderService } from "./service";
import { workOrderPlanningService } from "./planning-service";
import { lineOpenMeasured } from "./order-fulfillment";
import { AllocationInput, AllocationSummaryBar } from "./AllocationParts";
import {
  allocationErrorText,
  buildAllocations,
  canShowAllocate,
  fmtM,
  isAllocatableUnit,
  previewAllocation,
  qtyToInputText,
} from "./order-allocation";
import type { OrderLinkAllocationInput, WorkOrder } from "./types";

type Links = NonNullable<WorkOrder["orderLinks"]>;

/**
 * "Paylaştır" — iş emrinin AÇIK bağlarına metre paylaştırması (`PUT …/order-links/allocations`).
 * Yalnız plandır (sevk/karşılama ondan okumaz). Tavan ve özet sunucudan; şerit yazarken önizlemedir.
 */
export function AllocateOrderLinksDialog({
  open,
  onOpenChange,
  workOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder: WorkOrder;
}) {
  const qc = useQueryClient();
  // Detay sayfası/paneliyle AYNI anahtar: liste satırının bağları kumaş/miktar taşımaz.
  const detail = useQuery({
    queryKey: ["work-order-detail", workOrder.id],
    queryFn: () => workOrderService.getById(workOrder.id),
    enabled: open,
    staleTime: 60_000,
  });
  const wo = detail.data?.data ?? workOrder;
  const links = useMemo(() => wo.orderLinks ?? [], [wo.orderLinks]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  // Açılışta bir kez sunucu değerleriyle doldur; tazelenen detay kullanıcının yazdığını ezmez.
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || links.length === 0) return;
    seeded.current = true;
    setError(null);
    setQty(Object.fromEntries(links.map((l) => [l.orderLineId, qtyToInputText(l.allocatedQty)])));
  }, [open, links]);

  const allocations = buildAllocations(links, qty);
  const preview = previewAllocation(wo.allocation, (allocations ?? []).map((a) => a.allocatedQty));

  const mutation = useMutation({
    mutationFn: (body: OrderLinkAllocationInput[]) => workOrderPlanningService.setOrderLinkAllocations(workOrder.id, body),
    onSuccess: (res) => {
      toastServerSuccess(res, "Paylaştırma kaydedildi");
      // Sipariş açığını aşmak engel değil — sarı uyarı (alan verisi `data.warnings`).
      showServerWarnings({ warnings: res.data?.warnings });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrder.id] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
    },
    // Toast bastırıldı — cümle diyalogda; tavan değişmiş olabilir → detayı tazele.
    onError: (err, body) => {
      setError(allocationErrorText(err, body.reduce((s, a) => s + a.allocatedQty, 0)));
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrder.id] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-4 w-4" /> Metreyi Siparişlere Paylaştır — {wo.workOrderNumber}
          </DialogTitle>
          <DialogDescription>
            İş emrinin kumaşından her siparişe ne kadar ayrılacağını yazın (boş = paylaştırma yok). Bu yalnız plandır;
            sevkiyatı ve sipariş karşılamasını değiştirmez.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] overflow-auto rounded-md border">
          {detail.isLoading && links.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </div>
          ) : (
            <AllocateLinksTable links={links} qty={qty} onQty={(id, v) => setQty((p) => ({ ...p, [id]: v }))} />
          )}
        </div>

        <AllocationSummaryBar preview={preview} />
        {error && <Callout tone="danger">{error}</Callout>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            disabled={!allocations || allocations.length === 0 || mutation.isPending}
            onClick={() => allocations && mutation.mutate(allocations)}
          >
            {mutation.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllocateLinksTable({
  links,
  qty,
  onQty,
}: {
  links: Links;
  qty: Readonly<Record<string, string>>;
  onQty: (orderLineId: string, v: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-muted text-xs">
        <tr>
          <th className="p-2 text-left font-medium">Sipariş / Müşteri</th>
          <th className="p-2 text-left font-medium">Kumaş / Renk</th>
          <th className="p-2 text-right font-medium">Açık</th>
          <th className="p-2 text-right font-medium">Paylaştır</th>
        </tr>
      </thead>
      <tbody>
        {links.map((l) => {
          const ol = l.orderLine;
          const open = ol ? lineOpenMeasured(ol) : null;
          const orderNo = ol?.order?.orderNumber ?? "—";
          return (
            <tr key={l.orderLineId} className="border-t">
              <td className="p-2">
                <div className="font-mono text-xs">{orderNo}</div>
                <div className="text-xs text-muted-foreground">{ol?.order?.customer?.name ?? ""}</div>
              </td>
              <td className="p-2">
                <div>{ol?.item?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {ol?.color?.name ?? "renksiz"}
                  {ol?.width != null ? ` · ${fmtM(Number(ol.width))} cm` : ""}
                </div>
              </td>
              <td className="p-2 text-right tabular-nums">
                <div className="font-medium">{open === null ? "ölçülmüyor" : `${fmtM(open)} m`}</div>
                {ol?.quantity != null && (
                  <div className="text-[11px] text-muted-foreground">{fmtM(Number(ol.quantity))} istendi</div>
                )}
              </td>
              <td className="p-2">
                {isAllocatableUnit(ol?.unit) ? (
                  <AllocationInput
                    label={`${orderNo} paylaştırılan metre`}
                    value={qty[l.orderLineId] ?? ""}
                    onChange={(v) => onQty(l.orderLineId, v)}
                  />
                ) : (
                  <div className="text-right text-[11px] text-muted-foreground">metre dışı</div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Tam sayfa başlık ve yan panel AYNI tuşu kullanır; görünürlük `canShowAllocate`. */
export function AllocateOrdersButton({ wo, look }: { wo: WorkOrder; look: "header" | "sheet" }) {
  const { hasPermission } = useRoleAccess();
  const [open, setOpen] = useState(false);
  if (!canShowAllocate(wo, hasPermission)) return null;
  const label = (
    <>
      <Split className="h-3.5 w-3.5" /> Paylaştır
    </>
  );
  return (
    <>
      {look === "header" ? (
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
      <AllocateOrderLinksDialog open={open} onOpenChange={setOpen} workOrder={wo} />
    </>
  );
}
