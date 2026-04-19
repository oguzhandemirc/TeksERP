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
import type { QualityGrade } from "@/types/models";

const gradeSchema = z.object({
  code: z
    .string()
    .min(1, "Kod zorunludur")
    .max(32, "En fazla 32 karakter")
    .regex(/^[A-Z0-9.\-_]+$/, "Sadece büyük harf, rakam, nokta/tire/alt çizgi"),
  name: z.string().min(1, "İsim zorunludur").max(80),
  description: z.string().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Geçerli bir HEX renk (örn: #10b981)")
    .optional()
    .or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999),
});

type GradeFormValues = z.infer<typeof gradeSchema>;

interface QualityGradeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade: QualityGrade | null;
  onSubmit: (data: Partial<QualityGrade>) => void;
  isLoading: boolean;
}

export default function QualityGradeFormDialog({
  open,
  onOpenChange,
  grade,
  onSubmit,
  isLoading,
}: QualityGradeFormDialogProps) {
  const isEdit = !!grade;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GradeFormValues>({
    resolver: zodResolver(gradeSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      color: "",
      sortOrder: 0,
    },
  });

  useEffect(() => {
    if (open) {
      reset(
        grade
          ? {
              code: grade.code,
              name: grade.name,
              description: grade.description ?? "",
              color: grade.color ?? "",
              sortOrder: grade.sortOrder,
            }
          : {
              code: "",
              name: "",
              description: "",
              color: "",
              sortOrder: 0,
            },
      );
    }
  }, [open, grade, reset]);

  const submit = (data: GradeFormValues) => {
    onSubmit({
      code: data.code,
      name: data.name,
      description: data.description?.trim() ? data.description.trim() : null,
      color: data.color?.trim() ? data.color.trim() : null,
      sortOrder: data.sortOrder,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Kalite Derecesini Düzenle" : "Yeni Kalite Derecesi"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code" error={!!errors.code}>
              Kod
            </Label>
            <Input
              id="code"
              {...register("code")}
              error={!!errors.code}
              placeholder="ör: A1"
              disabled={isEdit}
              className="font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Benzersiz kısa kod. Oluşturulduktan sonra değiştirilemez —
              Roll.qualityGrade snapshot'ı bu değere işaret eder.
            </p>
            {errors.code && (
              <p className="text-sm text-destructive">{errors.code.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" error={!!errors.name}>
              Görünen Ad
            </Label>
            <Input
              id="name"
              {...register("name")}
              error={!!errors.name}
              placeholder="ör: A1 (Alt Kalite)"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="color" error={!!errors.color}>
                Renk (HEX)
              </Label>
              <Input
                id="color"
                {...register("color")}
                error={!!errors.color}
                placeholder="#10b981"
                className="font-mono"
              />
              {errors.color && (
                <p className="text-sm text-destructive">
                  {errors.color.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sortOrder" error={!!errors.sortOrder}>
                Sıra
              </Label>
              <Input
                id="sortOrder"
                type="number"
                {...register("sortOrder")}
                error={!!errors.sortOrder}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Açıklama</Label>
            <Input
              id="description"
              {...register("description")}
              placeholder="Kısa açıklama (opsiyonel)"
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
