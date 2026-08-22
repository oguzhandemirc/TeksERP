import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import {
  returnReasonFormDefaults,
  returnReasonFormSchema,
  type ReturnReasonFormValues,
} from "./schema";
import type { ReturnReason } from "./types";

import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ReturnReason | null;
  onSubmit: (values: ReturnReasonFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ReturnReasonFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: ReturnReasonFormValues = initial
    ? {
        name: initial.name,
        description: initial.description ?? "",
        color: initial.color ?? "",
        isActive: initial.isActive,
      }
    : returnReasonFormDefaults;

  return (
    <EntityFormDialog<ReturnReasonFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "İade Nedenini Düzenle" : "Yeni İade Nedeni"}
      schema={returnReasonFormSchema}
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
            <Input id="name" autoFocus placeholder="Hasarlı, Yanlış Ürün..." {...form.register("name")} />
            {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir. */}
            <SimilarNamesWarning
              entity="return-reasons"
              name={form.watch("name") ?? ""}
              excludeId={initial?.id}
            />
          </FormField>
          <FormField label="Açıklama" htmlFor="description" error={form.formState.errors.description}>
            <Input id="description" placeholder="Opsiyonel açıklama" {...form.register("description")} />
          </FormField>
          <FormField
            label="Renk"
            error={form.formState.errors.color}
            hint="UI rozeti için hex kodu (opsiyonel)."
          >
            <Controller
              control={form.control}
              name="color"
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
