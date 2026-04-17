import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
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
import type { Machine } from "@/types/models";
import { stationService } from "@/services/stationService";

const machineSchema = z.object({
  stationId: z.string().min(1, "İstasyon seçiniz"),
  code: z.string().min(1, "Kod zorunludur"),
  name: z.string().min(1, "İsim zorunludur"),
  deviceIp: z.string().optional(),
});

type MachineFormValues = z.infer<typeof machineSchema>;

interface MachineFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: Machine | null;
  onSubmit: (data: MachineFormValues) => void;
  isLoading: boolean;
}

export default function MachineFormDialog({
  open,
  onOpenChange,
  machine,
  onSubmit,
  isLoading,
}: MachineFormDialogProps) {
  const isEdit = !!machine;

  const { data: stationsData } = useQuery({
    queryKey: ["stations", "all"],
    queryFn: () =>
      stationService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });

  const stationOptions =
    stationsData?.data?.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })) ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MachineFormValues>({
    resolver: zodResolver(machineSchema),
    defaultValues: {
      stationId: "",
      code: "",
      name: "",
      deviceIp: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset(
        machine
          ? {
              stationId: machine.stationId,
              code: machine.code,
              name: machine.name,
              deviceIp: machine.deviceIp ?? "",
            }
          : { stationId: "", code: "", name: "", deviceIp: "" },
      );
    }
  }, [open, machine, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Makine Düzenle" : "Yeni Makine"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((data) => {
          onSubmit({
            ...data,
            deviceIp: data.deviceIp?.trim() || undefined,
          });
        })} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stationId" error={!!errors.stationId}>İstasyon</Label>
            <Select
              id="stationId"
              {...register("stationId")}
              options={stationOptions}
              placeholder="İstasyon seçiniz"
            />
            {errors.stationId && (
              <p className="text-sm text-destructive">{errors.stationId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="code" error={!!errors.code}>Kod</Label>
            <Input
              id="code"
              {...register("code")}
              error={!!errors.code}
              disabled={isEdit}
              placeholder="ör: TEZGAH_04"
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
              placeholder="ör: Dokuma Tezgah 4"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="deviceIp">Cihaz IP</Label>
            <Input
              id="deviceIp"
              {...register("deviceIp")}
              placeholder="ör: 192.168.1.104"
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
