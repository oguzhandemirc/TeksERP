import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import { colorFormDefaults, colorFormSchema, type ColorFormValues } from "./schema";
import type { Color } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Color | null;
  onSubmit: (values: ColorFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ColorFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: ColorFormValues = initial
    ? {
        name: initial.name,
        hex: initial.hex ?? "",
        sortOrder: initial.sortOrder,
        isActive: initial.isActive,
      }
    : colorFormDefaults;

  return (
    <EntityFormDialog<ColorFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Rengi Düzenle" : "Yeni Renk"}
      schema={colorFormSchema}
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
              <Input id="name" autoFocus placeholder="Mavi, Kırmızı..." {...form.register("name")} />
            </FormField>
            <FormField label="Sıra" htmlFor="sortOrder" error={form.formState.errors.sortOrder} required>
              <Input id="sortOrder" type="number" min={0} {...form.register("sortOrder")} />
            </FormField>
          </div>
          <FormField
            label="Renk"
            error={form.formState.errors.hex}
            hint="Hex kodu yazabilir veya paletten seçebilirsin."
          >
            <Controller
              control={form.control}
              name="hex"
              render={({ field }) => (
                <ColorPickerInput value={field.value ?? ""} onChange={field.onChange} />
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
