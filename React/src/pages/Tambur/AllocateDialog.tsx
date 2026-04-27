import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { tamburService } from "@/services/tamburService";
import { orderService } from "@/services/orderService";
import type { Roll, OrderLine } from "@/types/models";

const allocateSchema = z.object({
  orderLineId: z.string().min(1, "Sipariş kalemi seçiniz"),
  allocatedQty: z.string().min(1, "Miktar zorunludur"),
});

type AllocateFormValues = z.infer<typeof allocateSchema>;

interface AllocateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roll: Roll | null;
}

export default function AllocateDialog({
  open,
  onOpenChange,
  roll,
}: AllocateDialogProps) {
  const qc = useQueryClient();

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

  const orderLines: { value: string; label: string; maxQty: number }[] = [];
  ordersData?.data?.forEach((order) => {
    order.lines?.forEach((line: OrderLine) => {
      const allocated = line.allocations?.reduce(
        (s, a) => s + a.allocatedQty,
        0,
      ) ?? 0;
      const remaining = line.quantity - allocated;
      if (remaining > 0) {
        orderLines.push({
          value: line.id,
          label: `${order.orderNumber} — ${line.item?.code ?? "?"} (Kalan: ${remaining}m)`,
          maxQty: remaining,
        });
      }
    });
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AllocateFormValues>({
    resolver: zodResolver(allocateSchema),
    defaultValues: { orderLineId: "", allocatedQty: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ orderLineId: "", allocatedQty: "" });
    }
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: (data: {
      rollId: string;
      orderLineId: string;
      allocatedQty: number;
    }) => tamburService.allocate(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "Tahsis başarılı");
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["roll-detail"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-detail"] });
      qc.invalidateQueries({ queryKey: ["tambur-pending"] });
      qc.invalidateQueries({ queryKey: ["packaging-pending"] });
      qc.invalidateQueries({ queryKey: ["ready-orders"] });
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Tahsis başarısız");
    },
  });

  const handleFormSubmit = (data: AllocateFormValues) => {
    if (!roll) return;
    const qty = Number(data.allocatedQty);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Geçerli bir miktar giriniz");
      return;
    }
    mutation.mutate({
      rollId: roll.id,
      orderLineId: data.orderLineId,
      allocatedQty: qty,
    });
  };

  const existingAllocated =
    roll?.allocations?.reduce((s, a) => s + a.allocatedQty, 0) ?? 0;
  const available = (roll?.currentQty ?? 0) - existingAllocated;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Siparişe Tahsis Et</DialogTitle>
          <DialogDescription>
            {roll && (
              <span>
                <strong>{roll.barcode}</strong> — Kullanılabilir: {available}m
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orderLineId" error={!!errors.orderLineId}>
              Sipariş Kalemi
            </Label>
            <Select
              id="orderLineId"
              {...register("orderLineId")}
              options={orderLines.map((ol) => ({
                value: ol.value,
                label: ol.label,
              }))}
              placeholder="Sipariş kalemi seçiniz"
            />
            {errors.orderLineId && (
              <p className="text-sm text-destructive">
                {errors.orderLineId.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="allocatedQty" error={!!errors.allocatedQty}>
              Tahsis Miktarı (m)
            </Label>
            <Input
              id="allocatedQty"
              type="number"
              step="0.1"
              {...register("allocatedQty")}
              error={!!errors.allocatedQty}
              placeholder={`Maks: ${available}m`}
              className="h-12 text-lg"
            />
            {errors.allocatedQty && (
              <p className="text-sm text-destructive">
                {errors.allocatedQty.message}
              </p>
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
            <Button type="submit" isLoading={mutation.isPending}>
              Tahsis Et
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
