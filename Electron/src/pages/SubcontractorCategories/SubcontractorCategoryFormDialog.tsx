import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import {
  subcontractorCategoryFormDefaults,
  subcontractorCategoryFormSchema,
  type SubcontractorCategoryFormValues,
} from "./schema";
import type { SubcontractorCategory } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: SubcontractorCategory | null;
  onSubmit: (values: SubcontractorCategoryFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function SubcontractorCategoryFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
}: Props) {
  const defaults: SubcontractorCategoryFormValues = initial
    ? {
        name: initial.name,
        description: initial.description ?? "",
        isActive: initial.isActive,
      }
    : subcontractorCategoryFormDefaults;

  return (
    <EntityFormDialog<SubcontractorCategoryFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Kategoriyi Düzenle" : "Yeni Fason Kategorisi"}
      schema={subcontractorCategoryFormSchema}
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
            <Input id="name" autoFocus placeholder="Boyahane, Baskı, Yıkama..." {...form.register("name")} />
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
