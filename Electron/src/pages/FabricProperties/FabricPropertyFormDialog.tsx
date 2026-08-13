import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import { PropertyStationsField } from "@/components/forms/PropertyStationsField";
import { PropertyValuesField } from "./PropertyValuesField";
import {
  fabricPropertyFormDefaults,
  fabricPropertyFormSchema,
  type FabricPropertyFormValues,
} from "./schema";
import type { FabricProperty } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: FabricProperty | null;
  onSubmit: (values: FabricPropertyFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function FabricPropertyFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
}: Props) {
  const defaults: FabricPropertyFormValues = initial
    ? {
        name: initial.name,
        category: initial.category ?? "",
        description: initial.description ?? "",
        color: initial.color ?? "",
        stationIds: (initial.stationCapabilities ?? []).map((c) => c.stationId),
        valueType: initial.valueType ?? "FLAG",
        // Pasif değerler de forma gelir: gizlenirse kaydetmek onları listeden
        // düşürür ve backend replace'i geri getirilemez şekilde pasif bırakır.
        values: (initial.values ?? []).map((v) => ({
          code: v.code,
          name: v.name,
          isActive: v.isActive,
        })),
        isActive: initial.isActive,
      }
    : fabricPropertyFormDefaults;

  const savedCodes = (initial?.values ?? []).map((v) => v.code);

  return (
    <EntityFormDialog<FabricPropertyFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Özelliği Düzenle" : "Yeni Kumaş Özelliği"}
      schema={fabricPropertyFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {initial?.code && (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          )}
          <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus placeholder="Yanmazlık, Su Geçirmezlik..." {...form.register("name")} />
          </FormField>
          <FormField
            label="Kategori"
            htmlFor="category"
            error={form.formState.errors.category}
            hint="UI'da gruplandırma için (örn. Dayanıklılık, Yüzey, Kimyasal)"
          >
            <Input id="category" placeholder="Dayanıklılık" {...form.register("category")} />
          </FormField>
          <FormField label="Renk" error={form.formState.errors.color} hint="UI rozetinde gözükecek renk.">
            <Controller
              control={form.control}
              name="color"
              render={({ field }) => (
                <ColorPickerInput value={field.value ?? ""} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField label="Açıklama" htmlFor="description" error={form.formState.errors.description}>
            <Input id="description" {...form.register("description")} />
          </FormField>

          <FormField
            label="Özellik tipi"
            error={form.formState.errors.valueType}
            required
            hint="Bayrak: topta var/yok (Zımparalı). Seçim: birbirini dışlayan değerlerden biri (Kat → 2-KAT/4-KAT)."
          >
            <Controller
              control={form.control}
              name="valueType"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                  {(
                    [
                      ["FLAG", "Bayrak (var/yok)"],
                      ["CHOICE", "Seçim (değer listesi)"],
                    ] as const
                  ).map(([val, label]) => (
                    <Button
                      key={val}
                      type="button"
                      variant={field.value === val ? "default" : "outline"}
                      onClick={() => field.onChange(val)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              )}
            />
          </FormField>

          {form.watch("valueType") === "CHOICE" && (
            <FormField
              label="İzin verilen değerler"
              error={form.formState.errors.values as { message?: string } | undefined}
              required
              hint="Kod kimliktir (İngilizce harflerle, örn. TUP); Ad ekranda görünür (Tüp). Kayıtlı bir değer silinmez, pasifleştirilir."
            >
              <Controller
                control={form.control}
                name="values"
                render={({ field }) => (
                  <PropertyValuesField
                    value={field.value ?? []}
                    onChange={field.onChange}
                    existingCodes={savedCodes}
                  />
                )}
              />
            </FormField>
          )}
          <FormField
            label="Bu özelliği uygulayan istasyonlar"
            error={form.formState.errors.stationIds}
            required
            hint="İş emri rotasında bu istasyonlardan biri varsa özellik seçilebilir. Boş bırakılamaz — istasyonsuz özellik hiçbir iş emrinde görünmez."
          >
            <Controller
              control={form.control}
              name="stationIds"
              render={({ field }) => (
                <div className="h-56">
                  <PropertyStationsField
                    value={field.value ?? []}
                    onChange={field.onChange}
                  />
                </div>
              )}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
