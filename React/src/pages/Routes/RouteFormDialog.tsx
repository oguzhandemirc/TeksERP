import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown } from "lucide-react";
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
import type { Route } from "@/types/models";
import { stationService } from "@/services/stationService";

const routeSchema = z.object({
  name: z.string().min(1, "Rota ismi zorunludur"),
});

type RouteFormValues = z.infer<typeof routeSchema>;

interface StepEntry {
  stationId: string;
  sequence: number;
}

interface RouteFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  route: Route | null;
  onSubmit: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}

export default function RouteFormDialog({
  open,
  onOpenChange,
  route,
  onSubmit,
  isLoading,
}: RouteFormDialogProps) {
  const isEdit = !!route;
  const [steps, setSteps] = useState<StepEntry[]>([]);

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
    stationsData?.data?.map((s) => ({
      value: s.id,
      label: `${s.code} - ${s.name}`,
    })) ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RouteFormValues>({
    resolver: zodResolver(routeSchema),
    defaultValues: { name: "" },
  });

  useEffect(() => {
    if (open) {
      if (route) {
        reset({ name: route.name });
        setSteps(
          route.steps?.map((s) => ({
            stationId: s.stationId,
            sequence: s.sequence,
          })) ?? [],
        );
      } else {
        reset({ name: "" });
        setSteps([]);
      }
    }
  }, [open, route, reset]);

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { stationId: "", sequence: prev.length + 1 },
    ]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((s, i) => ({ ...s, sequence: i + 1 })),
    );
  };

  const updateStep = (index: number, stationId: string) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, stationId } : s)),
    );
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    setSteps((prev) => {
      const arr = [...prev];
      const targetIdx = direction === "up" ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= arr.length) return prev;
      [arr[index], arr[targetIdx]] = [arr[targetIdx], arr[index]];
      return arr.map((s, i) => ({ ...s, sequence: i + 1 }));
    });
  };

  const handleFormSubmit = (data: RouteFormValues) => {
    const validSteps = steps.filter((s) => s.stationId);
    if (isEdit) {
      onSubmit({
        name: data.name,
        steps: {
          deleteMany: {},
          create: validSteps,
        },
      });
    } else {
      onSubmit({
        name: data.name,
        ...(validSteps.length > 0 && { steps: { create: validSteps } }),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Rota Düzenle" : "Yeni Rota"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" error={!!errors.name}>Rota İsmi</Label>
            <Input
              id="name"
              {...register("name")}
              error={!!errors.name}
              placeholder="ör: Yeni Baskı Rotası"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Rota Adımları</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStep}
              >
                <Plus className="h-4 w-4 mr-1" />
                Adım Ekle
              </Button>
            </div>

            {steps.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                Henüz adım eklenmedi. "Adım Ekle" butonuna tıklayarak istasyon ekleyebilirsiniz.
              </p>
            )}

            <div className="space-y-2">
              {steps.map((step, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-muted-foreground w-8 shrink-0">
                    #{step.sequence}
                  </span>
                  <Select
                    value={step.stationId}
                    onChange={(e) => updateStep(index, e.target.value)}
                    options={stationOptions}
                    placeholder="İstasyon seçiniz"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    onClick={() => moveStep(index, "up")}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === steps.length - 1}
                    onClick={() => moveStep(index, "down")}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeStep(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
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
