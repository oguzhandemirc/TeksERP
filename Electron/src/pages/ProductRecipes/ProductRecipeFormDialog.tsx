import { useEffect } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { PropertyChipsField } from "@/components/forms/PropertyChipsField";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { TargetItemPicker } from "@/pages/Operations/WorkOrders/TargetItemPicker";
import { TargetColorSelect } from "@/pages/Operations/WorkOrders/TargetItemFields";
import type { WorkOrderFormValues } from "@/pages/Operations/WorkOrders/schema";
import {
  recipeFormDefaults,
  recipeFormSchema,
  type RecipeFormValues,
} from "./schema";
import type { ProductRecipe } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ProductRecipe | null;
  onSubmit: (values: RecipeFormValues) => Promise<void>;
  isSubmitting?: boolean;
}

function buildDefaults(initial?: ProductRecipe | null): RecipeFormValues {
  if (!initial) return recipeFormDefaults;
  return {
    name: initial.name,
    targetItemId: initial.itemId,
    targetColorId: initial.colorId,
    targetPropertyIds: (initial.properties ?? []).map((p) => p.propertyId),
    routeTemplateId: initial.routeId ?? "",
    width: initial.width,
    foldType: initial.foldType ?? "",
    isActive: initial.isActive,
  };
}

export function ProductRecipeFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(initial);
  const form = useForm<RecipeFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(recipeFormSchema as any) as unknown as Resolver<RecipeFormValues>,
    defaultValues: buildDefaults(initial),
  });

  useEffect(() => {
    if (open) form.reset(buildDefaults(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // Hedef ürün/renk picker'ları WorkOrderFormValues'a tipli — alan adları aynı
  // olduğu için control'ü güvenle cast ediyoruz (targetItemId/targetColorId).
  const woControl = form.control as unknown as Control<WorkOrderFormValues>;
  const watchedItemId = useWatch({ control: form.control, name: "targetItemId" });

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!values.targetItemId) {
      form.setError("targetItemId", { type: "manual", message: "Ürün seçilmeli." });
      return;
    }
    await onSubmit(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Reçeteyi Düzenle" : "Yeni Üretim Reçetesi"}</DialogTitle>
          <DialogDescription>
            Ürün + renk + özellik + en + rota'yı tek isim altında topla. İş emri
            açılışında reçeteyi seçince hepsi otomatik dolar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isEdit && initial?.code && (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          )}

          <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus placeholder="Patos Gri 038" {...form.register("name")} />
          </FormField>

          <FormField
            label="Hedef Ürün"
            required
            error={form.formState.errors.targetItemId}
          >
            <TargetItemPicker
              control={woControl}
              onItemChange={() => {
                form.setValue("targetColorId", null);
                form.setValue("targetPropertyIds", []);
              }}
            />
          </FormField>

          <FormField label="Hedef Renk (opsiyonel)">
            <TargetColorSelect control={woControl} />
          </FormField>

          <FormField label="Üretim Özellikleri (opsiyonel)">
            <Controller
              control={form.control}
              name="targetPropertyIds"
              render={({ field }) => (
                <PropertyChipsField
                  itemId={watchedItemId ?? ""}
                  value={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="En (cm)" htmlFor="width" error={form.formState.errors.width}>
              <Input
                id="width"
                type="number"
                step="0.1"
                min={0}
                placeholder="150"
                {...form.register("width")}
              />
            </FormField>
            <FormField label="Kat Tipi (opsiyonel)">
              <Controller
                control={form.control}
                name="foldType"
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2">
                    {(["2-KAT", "4-KAT"] as const).map((opt) => {
                      const active = field.value === opt;
                      return (
                        <Button
                          key={opt}
                          type="button"
                          variant={active ? "default" : "outline"}
                          onClick={() => field.onChange(active ? "" : opt)}
                        >
                          {opt}
                        </Button>
                      );
                    })}
                  </div>
                )}
              />
            </FormField>
          </div>

          <FormField
            label="Rota (opsiyonel)"
            hint="Bu reçete seçilince iş emrine bu rota gelir."
          >
            <Controller
              control={form.control}
              name="routeTemplateId"
              render={({ field }) => (
                <ReferenceSelect<ProductionRoute>
                  value={field.value || undefined}
                  onChange={(v) => field.onChange(v ?? "")}
                  service={routeService}
                  queryKey="routes"
                  getLabel={(r) => r.name}
                  placeholder="Rota şablonu seç..."
                  nullable
                  noneLabel="— Rota yok"
                />
              )}
            />
          </FormField>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
