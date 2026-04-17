import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Station } from "@/types/models";
import { StationType, stationTypeLabels } from "@/types/enums";

const stationSchema = z.object({
  code: z.string().min(1, "Kod zorunludur"),
  name: z.string().min(1, "İsim zorunludur"),
  type: z.nativeEnum(StationType, { message: "Tür seçiniz" }),
  department: z.string().optional(),
});

type StationFormValues = z.infer<typeof stationSchema>;

interface StationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  station: Station | null;
  onSubmit: (data: StationFormValues) => void;
  isLoading: boolean;
}

const stationTypeOptions = Object.entries(stationTypeLabels).map(
  ([value, label]) => ({ value, label }),
);

export default function StationFormDialog({
  open,
  onOpenChange,
  station,
  onSubmit,
  isLoading,
}: StationFormDialogProps) {
  const isEdit = !!station;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<StationFormValues>({
    resolver: zodResolver(stationSchema),
    defaultValues: {
      code: "",
      name: "",
      type: StationType.INTERNAL,
      department: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset(
        station
          ? {
              code: station.code,
              name: station.name,
              type: station.type,
              department: station.department ?? "",
            }
          : { code: "", name: "", type: StationType.INTERNAL, department: "" },
      );
    }
  }, [open, station, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "İstasyon Düzenle" : "Yeni İstasyon"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code" error={!!errors.code}>Kod</Label>
            <Input
              id="code"
              {...register("code")}
              error={!!errors.code}
              placeholder="ör: SARDON_1"
            />
            {errors.code && (
              <p className="text-sm text-destructive">{errors.code.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" error={!!errors.name}>İsim</Label>
            <Input
              id="name"
              {...register("name")}
              error={!!errors.name}
              placeholder="ör: Şardon Makinesi"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="type" error={!!errors.type}>Tür</Label>
            <Select
              id="type"
              {...register("type")}
              options={stationTypeOptions}
            />
            {errors.type && (
              <p className="text-sm text-destructive">{errors.type.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="department">Departman</Label>
            <Input
              id="department"
              {...register("department")}
              placeholder="ör: TERBİYE, DOKUMA"
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
            <Button type="submit" isLoading={isLoading}>
              {isEdit ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
