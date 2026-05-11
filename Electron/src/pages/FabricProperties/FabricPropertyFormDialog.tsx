import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
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
        sortOrder: initial.sortOrder,
        isActive: initial.isActive,
      }
    : fabricPropertyFormDefaults;

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
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
              <Input id="name" autoFocus placeholder="Yanmazlık, Su Geçirmezlik..." {...form.register("name")} />
            </FormField>
            <FormField label="Sıra" htmlFor="sortOrder" error={form.formState.errors.sortOrder} required>
              <Input id="sortOrder" type="number" min={0} {...form.register("sortOrder")} />
            </FormField>
          </div>
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
