import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { ScanLine } from "lucide-react";
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
import { itemService } from "@/services/itemService";

const initialEntrySchema = z.object({
  itemId:       z.string().min(1, "Ürün seçiniz"),
  design:       z.string().max(200).optional(),
  width:        z.string().optional(),
  initialQty:   z.string().min(1, "Metraj zorunludur"),
  weightKg:     z.string().optional(),
  qualityGrade: z.string().optional(),
});

type InitialEntryFormValues = z.infer<typeof initialEntrySchema>;

interface InitialEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    itemId:        string;
    initialQty:    number;
    weightKg?:     number;
    qualityGrade?: string;
    design?:       string;
    width?:        number;
  }) => void;
  isLoading: boolean;
}

const qualityOptions = [
  { value: "1.KALITE", label: "1. Kalite" },
  { value: "A1",       label: "A1" },
  { value: "2.KALITE", label: "2. Kalite" },
  { value: "FIRE",     label: "Fire" },
];

export default function InitialEntryDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: InitialEntryDialogProps) {
  const { data: itemsData } = useQuery({
    queryKey: ["items", "all-active"],
    queryFn: () =>
      itemService.getAll({
        page:      1,
        pageSize:  500,
        sortBy:    "code",
        sortOrder: "asc",
        filters:   { isActive: "true" },
      }),
    enabled: open,
  });

  const itemOptions =
    itemsData?.data?.map((i) => ({
      value: i.id,
      label: `${i.code} - ${i.name}`,
    })) ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InitialEntryFormValues>({
    resolver: zodResolver(initialEntrySchema),
    defaultValues: {
      itemId: "", design: "", width: "",
      initialQty: "", weightKg: "", qualityGrade: "1.KALITE",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        itemId: "", design: "", width: "",
        initialQty: "", weightKg: "", qualityGrade: "1.KALITE",
      });
    }
  }, [open, reset]);

  const handleFormSubmit = (data: InitialEntryFormValues) => {
    const qty = Number(data.initialQty);
    if (isNaN(qty) || qty <= 0) return;
    onSubmit({
      itemId:       data.itemId,
      initialQty:   qty,
      weightKg:     data.weightKg  ? Number(data.weightKg)  || undefined : undefined,
      qualityGrade: data.qualityGrade || undefined,
      design:       data.design?.trim() || undefined,
      width:        data.width   ? Number(data.width)   || undefined : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            <DialogTitle>KK1 — Ham Stok Girişi</DialogTitle>
          </div>
          <DialogDescription>
            Devere makinesinden çıkan kumaşı kaydedin. Barkod otomatik üretilecektir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 px-1 -mt-1">
          <Badge variant="outline" className="text-xs font-mono">İSTASYON: KK1</Badge>
          <span className="text-xs text-muted-foreground">Kalite Kontrol 1</span>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 pt-1">

          {/* Ürün */}
          <div className="space-y-2">
            <Label htmlFor="itemId" error={!!errors.itemId}>Ürün (Stok Kartı) *</Label>
            <Select
              id="itemId"
              {...register("itemId")}
              options={itemOptions}
              placeholder="Ürün seçiniz"
            />
            {errors.itemId && (
              <p className="text-sm text-destructive">{errors.itemId.message}</p>
            )}
          </div>

          {/* Desen + En */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="design">Desen</Label>
              <Input
                id="design"
                {...register("design")}
                placeholder="ör: BALIK SIRTA, ÇUBUKLU"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="width">En (cm)</Label>
              <Input
                id="width"
                type="number"
                step="1"
                min="0"
                {...register("width")}
                placeholder="ör: 280"
              />
            </div>
          </div>

          {/* Metraj + KG */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="initialQty" error={!!errors.initialQty}>Metraj (mt) *</Label>
              <Input
                id="initialQty"
                type="number"
                step="0.1"
                min="0"
                {...register("initialQty")}
                error={!!errors.initialQty}
                placeholder="ör: 120.5"
              />
              {errors.initialQty && (
                <p className="text-sm text-destructive">{errors.initialQty.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="weightKg">Ağırlık (kg)</Label>
              <Input
                id="weightKg"
                type="number"
                step="0.1"
                min="0"
                {...register("weightKg")}
                placeholder="ör: 45.2"
              />
            </div>
          </div>

          {/* Kalite */}
          <div className="space-y-2">
            <Label htmlFor="qualityGrade">Kalite Sınıfı</Label>
            <Select
              id="qualityGrade"
              {...register("qualityGrade")}
              options={qualityOptions}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" isLoading={isLoading}>
              <ScanLine className="h-4 w-4 mr-1.5" />
              Ham Stok Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
