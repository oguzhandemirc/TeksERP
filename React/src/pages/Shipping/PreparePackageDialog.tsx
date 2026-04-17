import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { shippingService } from "@/services/shippingService";

const packageSchema = z.object({
  packageId: z.string().min(1, "Paket ID zorunludur"),
  grossWeightKg: z.string().min(1, "Brüt kilo zorunludur"),
});

type PackageFormValues = z.infer<typeof packageSchema>;

interface PreparePackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedRolls?: { rollId: string; barcode: string }[];
}

export default function PreparePackageDialog({
  open,
  onOpenChange,
  preselectedRolls = [],
}: PreparePackageDialogProps) {
  const qc = useQueryClient();
  const [rolls, setRolls] = useState<{ rollId: string; barcode: string }[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PackageFormValues>({
    resolver: zodResolver(packageSchema),
    defaultValues: { packageId: "", grossWeightKg: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ packageId: "", grossWeightKg: "" });
      setRolls(preselectedRolls);
    }
  }, [open, preselectedRolls, reset]);

  const mutation = useMutation({
    mutationFn: (data: {
      rollIds: string[];
      packageId: string;
      grossWeightKg: number;
    }) => shippingService.preparePackage(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "Paketleme tamamlandı");
      qc.invalidateQueries({ queryKey: ["ready-orders"] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Paketleme başarısız");
    },
  });

  const handleFormSubmit = (data: PackageFormValues) => {
    if (rolls.length === 0) {
      toast.error("En az bir top seçiniz");
      return;
    }
    const weight = Number(data.grossWeightKg);
    if (isNaN(weight) || weight <= 0) {
      toast.error("Geçerli bir kilo giriniz");
      return;
    }
    mutation.mutate({
      rollIds: rolls.map((r) => r.rollId),
      packageId: data.packageId,
      grossWeightKg: weight,
    });
  };

  const removeRoll = (rollId: string) => {
    setRolls((prev) => prev.filter((r) => r.rollId !== rollId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paket Hazırla</DialogTitle>
          <DialogDescription>
            Seçili topları bir pakete (çuval/palet) atayın. Toplar SEVKE HAZIR
            durumuna geçer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {/* Selected Rolls */}
          <div className="space-y-2">
            <Label>Toplar ({rolls.length})</Label>
            {rolls.length === 0 ? (
              <p className="text-sm text-muted-foreground">Top seçilmedi</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {rolls.map((r) => (
                  <Badge key={r.rollId} variant="secondary" className="gap-1">
                    {r.barcode}
                    <button
                      type="button"
                      onClick={() => removeRoll(r.rollId)}
                      className="ml-0.5 hover:text-destructive cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="packageId" error={!!errors.packageId}>
              Paket ID / Barkod
            </Label>
            <Input
              id="packageId"
              {...register("packageId")}
              error={!!errors.packageId}
              placeholder="ör: PKT-001"
            />
            {errors.packageId && (
              <p className="text-sm text-destructive">
                {errors.packageId.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="grossWeightKg" error={!!errors.grossWeightKg}>
              Brüt Kilo (kg)
            </Label>
            <Input
              id="grossWeightKg"
              type="number"
              step="0.1"
              {...register("grossWeightKg")}
              error={!!errors.grossWeightKg}
              placeholder="ör: 85.5"
            />
            {errors.grossWeightKg && (
              <p className="text-sm text-destructive">
                {errors.grossWeightKg.message}
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
            <Button
              type="submit"
              isLoading={mutation.isPending}
              disabled={rolls.length === 0}
            >
              Paketle ({rolls.length} top)
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
