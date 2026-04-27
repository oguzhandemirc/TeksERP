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
import { shippingService } from "@/services/shippingService";
import { customerService } from "@/services/customerService";

const shipmentSchema = z.object({
  customerId: z.string().min(1, "Müşteri seçiniz"),
  driverName: z.string().optional(),
  plateNumber: z.string().optional(),
  carrier: z.string().optional(),
});

type ShipmentFormValues = z.infer<typeof shipmentSchema>;

interface CreateShipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (shipmentId: string) => void;
  preselectedCustomerId?: string;
}

export default function CreateShipmentDialog({
  open,
  onOpenChange,
  onCreated,
  preselectedCustomerId,
}: CreateShipmentDialogProps) {
  const qc = useQueryClient();

  const { data: customersData } = useQuery({
    queryKey: ["customers", "active-for-shipment"],
    queryFn: () =>
      customerService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });

  const customerOptions =
    customersData?.data?.map((c) => ({
      value: c.id,
      label: `${c.code} - ${c.name}`,
    })) ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentSchema),
    defaultValues: {
      customerId: "",
      driverName: "",
      plateNumber: "",
      carrier: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        customerId: preselectedCustomerId ?? "",
        driverName: "",
        plateNumber: "",
        carrier: "",
      });
    }
  }, [open, preselectedCustomerId, reset]);

  const mutation = useMutation({
    mutationFn: (data: ShipmentFormValues) =>
      shippingService.createShipment({
        customerId: data.customerId,
        driverName: data.driverName || undefined,
        plateNumber: data.plateNumber || undefined,
        carrier: data.carrier || undefined,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sevkiyat oluşturuldu");
      qc.invalidateQueries({ queryKey: ["shipments"] });
      qc.invalidateQueries({ queryKey: ["ready-orders"] });
      qc.invalidateQueries({ queryKey: ["ready-fason"] });
      onOpenChange(false);
      if (res.data?.id) {
        onCreated?.(res.data.id);
      }
    },
    onError: () => {
      toast.error("Sevkiyat oluşturulamadı");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni Sevkiyat (İrsaliye)</DialogTitle>
          <DialogDescription>
            İrsaliye numarası otomatik oluşturulur.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="customerId" error={!!errors.customerId}>
              Müşteri
            </Label>
            <Select
              id="customerId"
              {...register("customerId")}
              options={customerOptions}
              placeholder="Müşteri seçiniz"
            />
            {errors.customerId && (
              <p className="text-sm text-destructive">
                {errors.customerId.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="driverName">Şoför Adı</Label>
              <Input
                id="driverName"
                {...register("driverName")}
                placeholder="ör: Ahmet Yılmaz"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plateNumber">Plaka</Label>
              <Input
                id="plateNumber"
                {...register("plateNumber")}
                placeholder="ör: 34 ABC 123"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="carrier">Taşıyıcı Firma</Label>
            <Input
              id="carrier"
              {...register("carrier")}
              placeholder="ör: Hızlı Nakliyat"
            />
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
              İrsaliye Oluştur
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
