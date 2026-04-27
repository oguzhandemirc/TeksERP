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
import type { FabricProperty } from "@/types/models";

const propSchema = z.object({
  code: z
    .string()
    .min(1, "Kod zorunludur")
    .max(40, "En fazla 40 karakter")
    .regex(/^[A-Z0-9_-]+$/, "Sadece büyük harf, rakam, alt çizgi/tire"),
  name: z.string().min(1, "İsim zorunludur").max(80),
  category: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999),
});

type PropFormValues = z.infer<typeof propSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: FabricProperty | null;
  onSubmit: (data: Partial<FabricProperty>) => void;
  isLoading: boolean;
}

export default function FabricPropertyFormDialog({
  open,
  onOpenChange,
  property,
  onSubmit,
  isLoading,
}: Props) {
  const isEdit = !!property;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PropFormValues>({
    resolver: zodResolver(propSchema),
    defaultValues: {
      code: "",
      name: "",
      category: "",
      description: "",
      sortOrder: 0,
    },
  });

  useEffect(() => {
    if (open) {
      reset(
        property
          ? {
              code: property.code,
              name: property.name,
              category: property.category ?? "",
              description: property.description ?? "",
              sortOrder: property.sortOrder,
            }
          : {
              code: "",
              name: "",
              category: "",
              description: "",
              sortOrder: 0,
            },
      );
    }
  }, [open, property, reset]);

  const submit = (data: PropFormValues) => {
    onSubmit({
      code: data.code,
      name: data.name,
      category: data.category?.trim() ? data.category.trim() : null,
      description: data.description?.trim() ? data.description.trim() : null,
      sortOrder: data.sortOrder,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Özelliği Düzenle" : "Yeni Kumaş Özelliği"}
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
              placeholder="ör: YANMAZLIK"
              disabled={isEdit}
              className="font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Türetilmiş Item.code'da kullanılır. Oluşturulduktan sonra
              değiştirilemez.
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
              placeholder="ör: Yanmazlık"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="category" error={!!errors.category}>
                Kategori
              </Label>
              <Input
                id="category"
                {...register("category")}
                error={!!errors.category}
                placeholder="ör: Dayanıklılık, Yüzey"
              />
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
              placeholder="Opsiyonel kısa açıklama"
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
