import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Target } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { orderService } from "@/pages/Operations/Orders/service";
import type { Order } from "@/pages/Operations/Orders/types";
import { shipmentService } from "./service";

interface Props {
  shipmentId: string;
  customerId: string;
  branchId: string | null;
  currentOrderIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Yeniden hedeflenebilir sipariş statüleri (kapalı/iptal hariç).
const OPEN_STATUSES = ["PENDING", "APPROVED", "PARTIAL_SHIPPED"];

/**
 * Saha #7: sevkiyatın bağlı sipariş kümesini değiştir (yeniden hedefle). Müşteri+şube
 * açık siparişleri checkbox listede; READY/AT_DOOR'da karşılanma backend'de geri
 * sarılıp yeni kümeyle yeniden hesaplanır.
 */
export function RetargetOrdersDialog({
  shipmentId,
  customerId,
  branchId,
  currentOrderIds,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set(currentOrderIds));

  useEffect(() => {
    if (open) setSelected(new Set(currentOrderIds));
  }, [open, currentOrderIds]);

  // Müşteri (+şube) açık siparişleri.
  const ordersQ = useQuery({
    queryKey: ["orders", "retarget", customerId, branchId],
    queryFn: () =>
      orderService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "orderDate",
        sortOrder: "desc",
        filters: {
          customerId,
          ...(branchId ? { branchId } : {}),
          status: OPEN_STATUSES.join(","),
        },
      }),
    enabled: open,
    staleTime: 30_000,
  });
  // Şu an bağlı ama "açık" listesine girmeyen siparişler de seçili görünebilmeli.
  const orders = useMemo<Order[]>(() => ordersQ.data?.data ?? [], [ordersQ.data]);

  const mut = useMutation({
    mutationFn: () => shipmentService.retargetOrders(shipmentId, [...selected]),
    onSuccess: (res) => {
      toast.success(res.message ?? "Yeniden hedeflendi");
      void qc.invalidateQueries({ queryKey: ["shipment-detail", shipmentId] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onOpenChange(false);
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" /> Siparişleri Yeniden Hedefle
          </DialogTitle>
          <DialogDescription>
            Bu sevkiyatın hangi siparişlere sayılacağını seç. Sevke hazır/kapı önündeki
            sevkiyatta karşılanma otomatik yeniden hesaplanır (eski siparişlerden düşülür).
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border p-1">
          {ordersQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : orders.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Bu müşteri/şube için açık sipariş yok.
            </p>
          ) : (
            orders.map((o) => {
              const checked = selected.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
                    checked && "bg-primary/5",
                  )}
                >
                  <input type="checkbox" checked={checked} readOnly className="h-4 w-4 accent-primary" />
                  <span className="font-mono font-medium">{o.orderNumber}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {o.deadline ? `termin ${safeFormat(o.deadline, "dd.MM.yyyy")}` : "termin yok"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">{selected.size} sipariş seçili</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
              Vazgeç
            </Button>
            <Button
              onClick={() => mut.mutate()}
              disabled={selected.size === 0 || mut.isPending}
              className="gap-1.5"
            >
              {mut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Hedefle
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
