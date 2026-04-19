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
import type { DefectType } from "@/types/models";

const severityLabels: Record<"MINOR" | "MAJOR" | "CRITICAL", string> = {
  MINOR: "Düşük (Minor)",
  MAJOR: "Orta (Major)",
  CRITICAL: "Kritik (Critical)",
};

const defectSchema = z.object({
  code: z
    .string()
    .min(1, "Kod zorunludur")
    .max(40, "En fazla 40 karakter")
    .regex(/^[A-Z0-9_]+$/, "Sadece büyük harf, rakam ve alt çizgi"),
  name: z.string().min(1, "İsim zorunludur").max(80),
  description: z.string().max(500).optional(),
  severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]).optional().or(z.literal("")),
});

type DefectFormValues = z.infer<typeof defectSchema>;

interface DefectTypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defectType: DefectType | null;
  onSubmit: (data: Partial<DefectType>) => void;
  isLoading: boolean;
}

const severityOptions = [
  { value: "", label: "— Belirtilmedi —" },
  ...Object.entries(severityLabels).map(([value, label]) => ({ value, label })),
];

export default function DefectTypeFormDialog({
  open,
  onOpenChange,
  defectType,
  onSubmit,
  isLoading,
}: DefectTypeFormDialogProps) {
  const isEdit = !!defectType;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DefectFormValues>({
    resolver: zodResolver(defectSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      severity: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset(
        defectType
          ? {
              code: defectType.code,
              name: defectType.name,
              description: defectType.description ?? "",
              severity: defectType.severity ?? "",
            }
          : { code: "", name: "", description: "", severity: "" },
      );
    }
  }, [open, defectType, reset]);

  const submit = (data: DefectFormValues) => {
    onSubmit({
      code: data.code,
      name: data.name,
      description: data.description?.trim() ? data.description.trim() : null,
      severity:
        data.severity && data.severity !== ""
          ? (data.severity as "MINOR" | "MAJOR" | "CRITICAL")
          : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Hata Tipi Düzenle" : "Yeni Hata Tipi"}
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
              placeholder="ör: LEKE"
              disabled={isEdit}
              className="font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Benzersiz kısa kod. Oluşturulduktan sonra değiştirilemez.
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
              placeholder="ör: Leke"
            />
            <p className="text-xs text-muted-foreground">
              Operatörün tablet ekranında butonda gördüğü metin.
            </p>
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="severity">Önem Derecesi</Label>
            <Select
              id="severity"
              {...register("severity")}
              options={severityOptions}
            />
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
