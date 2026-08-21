import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels } from "@/types/enums";
import { orderService } from "./service";
import type {
  OrderCancelAction,
  OrderCancelPreviewWO,
} from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  orderNumber?: string;
  /** İptal başarılı olduğunda tetiklenir (dialog kendisi kapatır). */
  onCancelled?: () => void;
}

const ACTION_LABELS: Record<OrderCancelAction, string> = {
  UNLINK_ONLY: "Sadece bağı kopar",
  CONVERT_TO_STOCK: "İş emrini stoğa çevir",
  CANCEL_WO: "İş emrini de iptal et",
};

const ACTION_DESCRIPTIONS: Record<OrderCancelAction, string> = {
  UNLINK_ONLY:
    "İş emri ayakta kalır, sadece bu siparişle bağı kesilir. Diğer bağlı siparişler varsa onlar etkilenmez; bu iş emrinin TEK siparişi buysa bağ kalkınca iş emri Stok üretimine döner.",
  CONVERT_TO_STOCK:
    "İş emri 'Stoğa Üretim' tipine çevrilir; üretilen/üretilecek rulolar stoğa düşer ve başka müşteriye sevk edilebilir.",
  CANCEL_WO:
    "İş emri iptal edilir; başlayan üretim durur, bağlı fabrika topları stoğa çekilir, refakat kartı geçersizleşir.",
};

export function OrderCancelDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  onCancelled,
}: Props) {
  const qc = useQueryClient();
  const [actionByWO, setActionByWO] = useState<Record<string, OrderCancelAction>>({});

  const previewQuery = useQuery({
    queryKey: ["order-cancel-preview", orderId],
    queryFn: () => orderService.getCancelPreview(orderId as string),
    enabled: open && !!orderId,
    staleTime: 0,
  });

  const preview = previewQuery.data?.data ?? null;
  const affected = preview?.affectedWorkOrders ?? [];

  // Preview geldiğinde her WO için default seçim yap (kullanıcı dokunmadıysa).
  useEffect(() => {
    if (!preview) return;
    setActionByWO((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const wo of preview.affectedWorkOrders) {
        if (!(wo.id in next)) {
          next[wo.id] = wo.defaultAction;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [preview]);

  // Dialog her açılışta seçimleri sıfırla (önceki preview kalıntısı kalmasın).
  useEffect(() => {
    if (open) {
      setActionByWO({});
    }
  }, [open, orderId]);

  const cancelMut = useMutation({
    mutationFn: () => {
      if (!orderId) throw new Error("orderId missing");
      const actions = affected.map((wo) => ({
        workOrderId: wo.id,
        action: actionByWO[wo.id] ?? wo.defaultAction,
      }));
      return orderService.cancelWithActions(orderId, actions);
    },
    onSuccess: (res) => {
      toast.success(res.message ?? "Sipariş iptal edildi.");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
      onCancelled?.();
    },
  });

  const summary = useMemo(() => {
    const counts = { UNLINK_ONLY: 0, CONVERT_TO_STOCK: 0, CANCEL_WO: 0 };
    for (const wo of affected) {
      const a = actionByWO[wo.id] ?? wo.defaultAction;
      counts[a]++;
    }
    return counts;
  }, [affected, actionByWO]);

  const isLoading = previewQuery.isLoading;
  const hasError = previewQuery.isError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Siparişi İptal Et
            {orderNumber && (
              <span className="font-mono text-sm text-muted-foreground">
                · {orderNumber}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Bu işlem geri alınamaz. Aşağıda etkilenecek iş emirleri listelendi;
            her biri için ne yapılacağını seç. Onayladığında uygulanır.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : hasError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Preview alınamadı:{" "}
            {(previewQuery.error as Error | undefined)?.message ?? "Bilinmeyen hata"}
          </div>
        ) : affected.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-4 text-sm">
            Bu siparişe bağlı iş emri yok. Onayladığında sadece sipariş{" "}
            <strong>İptal</strong> durumuna geçer.
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {affected.map((wo) => (
              <WOActionRow
                key={wo.id}
                wo={wo}
                selected={actionByWO[wo.id] ?? wo.defaultAction}
                onChange={(action) =>
                  setActionByWO((prev) => ({ ...prev, [wo.id]: action }))
                }
              />
            ))}
          </div>
        )}

        {/* O2 fix: aktif sevkiyat bağı = backend her koşulda 409 — operatöre
            engeli somut göster, onay butonu aşağıda canCancel ile kapanır. */}
        {!isLoading && !hasError && preview && preview.canCancel === false && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="font-medium text-destructive">
              Bu sipariş aktif sevkiyata bağlı — iptal edilemez.
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Önce şu sevkiyat(lar) tamamlanmalı veya iptal edilmeli:{" "}
              {preview.activeShipments
                .map((s) => `${s.shipmentNo} (${s.status})`)
                .join(", ")}
            </div>
          </div>
        )}

        {affected.length > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Özet:</span>{" "}
            {summary.UNLINK_ONLY > 0 && (
              <span>{summary.UNLINK_ONLY} bağ koparılacak · </span>
            )}
            {summary.CONVERT_TO_STOCK > 0 && (
              <span>{summary.CONVERT_TO_STOCK} iş emri stoğa çevrilecek · </span>
            )}
            {summary.CANCEL_WO > 0 && (
              <span className="text-destructive">
                {summary.CANCEL_WO} iş emri iptal edilecek
              </span>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cancelMut.isPending}
          >
            Vazgeç
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => cancelMut.mutate()}
            disabled={isLoading || hasError || cancelMut.isPending || preview?.canCancel === false}
          >
            {cancelMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Siparişi İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WOActionRow({
  wo,
  selected,
  onChange,
}: {
  wo: OrderCancelPreviewWO;
  selected: OrderCancelAction;
  onChange: (a: OrderCancelAction) => void;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{wo.workOrderNumber}</span>
        <StatusBadge
          status={wo.status}
          labels={workOrderStatusLabels}
          tones={workOrderStatusTones}
        />
        {wo.targetQuantity != null && wo.targetQuantity > 0 && (
          <Badge variant="muted" className="text-[10px]">
            {wo.targetQuantity.toLocaleString("tr-TR", { useGrouping: false })} m hedef
          </Badge>
        )}
        {wo.producedRollCount > 0 && (
          <Badge variant="muted" className="text-[10px]">
            {wo.producedRollCount} rulo üretilmiş
          </Badge>
        )}
        {!wo.isSoleOrder && (
          <Badge variant="outline" className="text-[10px]">
            +{wo.otherOrdersCount} başka sipariş bağlı
          </Badge>
        )}
        {/* Tip = bağın aynası (2026-08-21): tek siparişli iş emrinde iptal etmeyen
            her aksiyon son bağı da siler → iş emri Stok üretimine döner. Operatör
            bunu seçimden ÖNCE görsün; "Stoğa çevir" ile "bağı kopar" burada aynı
            sonucu verir, fark yalnız niyet etiketi. */}
        {wo.isSoleOrder && selected !== "CANCEL_WO" && (
          <Badge
            variant="outline"
            className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400"
            title="Bu iş emrinin tek siparişi bu — bağ kalkınca iş emri Stok üretimine döner"
          >
            Stok üretimine döner
          </Badge>
        )}
      </div>

      {wo.allowedActions.length === 1 ? (
        (() => {
          const only = wo.allowedActions[0]!;
          return (
            <div className="mt-2 text-xs">
              <span className="font-medium">{ACTION_LABELS[only]}</span>
              <span className="text-muted-foreground">
                {" "}
                — {ACTION_DESCRIPTIONS[only]}
              </span>
            </div>
          );
        })()
      ) : (
        <div className="mt-2 space-y-1.5">
          {wo.allowedActions.map((a) => {
            const id = `${wo.id}-${a}`;
            const isSelected = selected === a;
            return (
              <label
                key={a}
                htmlFor={id}
                className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-input hover:bg-muted/50"
                }`}
              >
                <input
                  id={id}
                  type="radio"
                  name={`action-${wo.id}`}
                  checked={isSelected}
                  onChange={() => onChange(a)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div
                    className={`font-medium ${a === "CANCEL_WO" ? "text-destructive" : ""}`}
                  >
                    {ACTION_LABELS[a]}
                  </div>
                  <div className="text-muted-foreground">{ACTION_DESCRIPTIONS[a]}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
