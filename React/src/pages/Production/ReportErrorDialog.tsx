import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { productionService } from "@/services/productionService";

const errorSchema = z.object({
  rollId: z.string().min(1, "Top ID zorunludur"),
  startMeter: z.string().min(1, "Başlangıç metresi zorunludur"),
  endMeter: z.string().min(1, "Bitiş metresi zorunludur"),
  errorType: z.string().optional(),
});

type ErrorFormValues = z.infer<typeof errorSchema>;

interface ReportErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rollId?: string;
}

const errorTypeOptions = [
  { value: "LEKE", label: "Leke" },
  { value: "YIRTIK", label: "Yırtık" },
  { value: "DELIK", label: "Delik" },
  { value: "RENK_FARKI", label: "Renk Farkı" },
  { value: "ATKISI_HATASI", label: "Atkısı Hatası" },
  { value: "DIGER", label: "Diğer" },
];

export default function ReportErrorDialog({
  open,
  onOpenChange,
  rollId,
}: ReportErrorDialogProps) {
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ErrorFormValues>({
    resolver: zodResolver(errorSchema),
    defaultValues: {
      rollId: "",
      startMeter: "",
      endMeter: "",
      errorType: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        rollId: rollId ?? "",
        startMeter: "",
        endMeter: "",
        errorType: "",
      });
    }
  }, [open, rollId, reset]);

  const mutation = useMutation({
    mutationFn: (data: {
      rollId: string;
      startMeter: number;
      endMeter: number;
      errorType?: string;
    }) => productionService.reportError(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "Hata kaydı oluşturuldu");
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["roll-detail"] });
      qc.invalidateQueries({ queryKey: ["roll-history"] });
      qc.invalidateQueries({ queryKey: ["active-steps"] });
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Hata raporlanamadı");
    },
  });

  const handleFormSubmit = (data: ErrorFormValues) => {
    mutation.mutate({
      rollId: data.rollId,
      startMeter: Number(data.startMeter),
      endMeter: Number(data.endMeter),
      errorType: data.errorType || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hata Raporla (Kurşun / QC2)</DialogTitle>
          <DialogDescription>
            Tespit edilen hatayı metre aralığı ile kaydedin. Bu kayıtlar Tambur
            istasyonunda karar verme için kullanılır.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rollId" error={!!errors.rollId}>Top ID</Label>
            <Input
              id="rollId"
              {...register("rollId")}
              error={!!errors.rollId}
              placeholder="Top UUID"
              disabled={!!rollId}
            />
            {errors.rollId && (
              <p className="text-sm text-destructive">{errors.rollId.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startMeter" error={!!errors.startMeter}>
                Başlangıç (mt)
              </Label>
              <Input
                id="startMeter"
                type="number"
                step="0.1"
                {...register("startMeter")}
                error={!!errors.startMeter}
                placeholder="ör: 45.5"
              />
              {errors.startMeter && (
                <p className="text-sm text-destructive">
                  {errors.startMeter.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="endMeter" error={!!errors.endMeter}>
                Bitiş (mt)
              </Label>
              <Input
                id="endMeter"
                type="number"
                step="0.1"
                {...register("endMeter")}
                error={!!errors.endMeter}
                placeholder="ör: 46.2"
              />
              {errors.endMeter && (
                <p className="text-sm text-destructive">
                  {errors.endMeter.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="errorType">Hata Türü</Label>
            <Select
              id="errorType"
              {...register("errorType")}
              options={errorTypeOptions}
              placeholder="Tür seçiniz (opsiyonel)"
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
              Hata Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
