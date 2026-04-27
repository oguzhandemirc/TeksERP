import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, PackagePlus, Boxes } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  tamburService,
  type SplitAllocationItem,
} from "@/services/tamburService";
import { orderService } from "@/services/orderService";
import type { Roll, OrderLine } from "@/types/models";

interface SplitAllocateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roll: Roll | null;
}

type Row = {
  target: "ORDER" | "STOCK";
  orderLineId: string;
  qty: string;
};

const emptyRow = (): Row => ({
  target: "ORDER",
  orderLineId: "",
  qty: "",
});

export default function SplitAllocateDialog({
  open,
  onOpenChange,
  roll,
}: SplitAllocateDialogProps) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  const { data: ordersData } = useQuery({
    queryKey: ["orders", "active-for-allocate"],
    queryFn: () =>
      orderService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "createdAt",
        sortOrder: "desc",
        filters: {},
      }),
    enabled: open,
  });

  const orderLineOpts: { value: string; label: string }[] = [];
  ordersData?.data?.forEach((order) => {
    order.lines?.forEach((line: OrderLine) => {
      const allocated =
        line.allocations?.reduce((s, a) => s + a.allocatedQty, 0) ?? 0;
      const remaining = line.quantity - allocated;
      if (remaining > 0) {
        orderLineOpts.push({
          value: line.id,
          label: `${order.orderNumber} — ${line.item?.code ?? "?"} (Kalan: ${remaining.toFixed(1)}m)`,
        });
      }
    });
  });

  useEffect(() => {
    if (open) setRows([emptyRow()]);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!roll) throw new Error("Top bulunamadı");
      const allocations: SplitAllocationItem[] = rows
        .filter((r) => Number(r.qty) > 0)
        .map((r) => ({
          qty: Number(r.qty),
          targetStock: r.target === "STOCK",
          orderLineId: r.target === "ORDER" ? r.orderLineId : undefined,
        }));
      return tamburService.splitAllocate({ rollId: roll.id, allocations });
    },
    onSuccess: (res) => {
      toast.success(res.message ?? "Paylaştırma tamamlandı");
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["roll-detail"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-detail"] });
      qc.invalidateQueries({ queryKey: ["tambur-pending"] });
      qc.invalidateQueries({ queryKey: ["packaging-pending"] });
      qc.invalidateQueries({ queryKey: ["ready-orders"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Paylaştırma başarısız";
      toast.error(msg);
    },
  });

  const addRow = () => setRows((r) => [...r, emptyRow()]);
  const removeRow = (idx: number) =>
    setRows((r) => (r.length === 1 ? r : r.filter((_, i) => i !== idx)));

  const updateRow = (idx: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const existingAllocated =
    roll?.allocations?.reduce((s, a) => s + a.allocatedQty, 0) ?? 0;
  const available = Math.max(
    0,
    (roll?.currentQty ?? 0) - existingAllocated,
  );
  const totalRequested = rows.reduce(
    (sum, r) => sum + (Number(r.qty) || 0),
    0,
  );
  const overBudget = totalRequested > available + 0.0001;

  const canSubmit =
    !!roll &&
    !overBudget &&
    rows.some((r) => Number(r.qty) > 0) &&
    rows
      .filter((r) => Number(r.qty) > 0)
      .every((r) => (r.target === "ORDER" ? !!r.orderLineId : true));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            Çoklu Paylaştırma (Sipariş + Stok)
          </DialogTitle>
          <DialogDescription>
            {roll && (
              <>
                <strong>{roll.barcode}</strong> — Kullanılabilir:{" "}
                <strong>{available.toFixed(1)}m</strong>. Birden fazla siparişe
                bölebilir ve kalanı stoka aktarabilirsiniz.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto py-2">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="rounded-lg border p-3 space-y-3 bg-card"
            >
              <div className="flex items-center justify-between">
                <Badge variant="outline">#{idx + 1}</Badge>
                {rows.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(idx)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateRow(idx, { target: "ORDER", orderLineId: "" })
                  }
                  className={`h-11 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    row.target === "ORDER"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Siparişe
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateRow(idx, { target: "STOCK", orderLineId: "" })
                  }
                  className={`h-11 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    row.target === "STOCK"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Stoka
                </button>
              </div>

              {row.target === "ORDER" && (
                <div className="space-y-1">
                  <Label className="text-xs">Sipariş Kalemi</Label>
                  <Select
                    value={row.orderLineId}
                    onChange={(e) =>
                      updateRow(idx, { orderLineId: e.target.value })
                    }
                    options={orderLineOpts}
                    placeholder="Sipariş kalemi seçiniz"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Miktar (m)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={row.qty}
                  onChange={(e) => updateRow(idx, { qty: e.target.value })}
                  placeholder="ör: 45.5"
                  className="h-11"
                />
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            className="w-full"
          >
            <Plus className="h-4 w-4" /> Satır Ekle
          </Button>
        </div>

        <div className="rounded-md border p-3 flex items-center justify-between bg-muted/30">
          <div className="text-sm">
            Toplam Dağıtılan:{" "}
            <strong
              className={overBudget ? "text-destructive" : "text-foreground"}
            >
              {totalRequested.toFixed(1)}m
            </strong>{" "}
            / {available.toFixed(1)}m
          </div>
          {overBudget && (
            <Badge variant="destructive">Limit aşıldı</Badge>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            İptal
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            isLoading={mutation.isPending}
          >
            <PackagePlus className="h-4 w-4" /> Paylaştır ve Etiket Bas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
