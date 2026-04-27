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
import type { Color } from "@/types/models";

const colorSchema = z.object({
  code: z
    .string()
    .min(1, "Kod zorunludur")
    .max(32, "En fazla 32 karakter")
    .regex(/^[A-Z0-9_-]+$/, "Sadece büyük harf, rakam, alt çizgi/tire"),
  name: z.string().min(1, "İsim zorunludur").max(80),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Geçerli HEX (örn: #1d4ed8)")
    .optional()
    .or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999),
});

type ColorFormValues = z.infer<typeof colorSchema>;

interface ColorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  color: Color | null;
  onSubmit: (data: Partial<Color>) => void;
  isLoading: boolean;
}

export default function ColorFormDialog({
  open,
  onOpenChange,
  color,
  onSubmit,
  isLoading,
}: ColorFormDialogProps) {
  const isEdit = !!color;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ColorFormValues>({
    resolver: zodResolver(colorSchema),
    defaultValues: {
      code: "",
      name: "",
      hex: "",
      sortOrder: 0,
    },
  });

  const hexValue = watch("hex");

  useEffect(() => {
    if (open) {
      reset(
        color
          ? {
              code: color.code,
              name: color.name,
              hex: color.hex ?? "",
              sortOrder: color.sortOrder,
            }
          : { code: "", name: "", hex: "", sortOrder: 0 },
      );
    }
  }, [open, color, reset]);

  const submit = (data: ColorFormValues) => {
    onSubmit({
      code: data.code,
      name: data.name,
      hex: data.hex?.trim() ? data.hex.trim() : null,
      sortOrder: data.sortOrder,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Rengi Düzenle" : "Yeni Renk"}
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
              placeholder="ör: MAVI"
              disabled={isEdit}
              className="font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Türetilmiş Item.code'da kullanılır (ör: PATOS-MAVI-YANMAZLIK).
              Oluşturulduktan sonra değiştirilemez.
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
              placeholder="ör: Mavi"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="hex" error={!!errors.hex}>
                Renk (HEX)
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="hex"
                  {...register("hex")}
                  error={!!errors.hex}
                  placeholder="#1d4ed8"
                  className="font-mono"
                />
                {hexValue && /^#[0-9a-fA-F]{6}$/.test(hexValue) && (
                  <span
                    className="inline-block h-9 w-9 rounded border shrink-0"
                    style={{ backgroundColor: hexValue }}
                  />
                )}
              </div>
              {errors.hex && (
                <p className="text-sm text-destructive">
                  {errors.hex.message}
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
