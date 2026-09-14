import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defectSeverityLabels } from "@/types/enums";
import { defectTypeFormDefaults, defectTypeFormSchema, type DefectTypeFormValues } from "./schema";
import type { DefectType } from "./types";

import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: DefectType | null;
  onSubmit: (values: DefectTypeFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function DefectTypeFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: DefectTypeFormValues = initial
    ? {
        name: initial.name,
        description: initial.description ?? "",
        severity: (initial.severity ?? "") as DefectTypeFormValues["severity"],
        isActive: initial.isActive,
        isDefault: initial.isDefault,
      }
    : defectTypeFormDefaults;

  return (
    <EntityFormDialog<DefectTypeFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Hata Tipini Düzenle" : "Yeni Hata Tipi"}
      schema={defectTypeFormSchema}
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
            <Input id="name" autoFocus {...form.register("name")} />
            {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir. */}
            <SimilarNamesWarning
              entity="defect-types"
              name={form.watch("name") ?? ""}
              excludeId={initial?.id}
            />
          </FormField>
          <FormField label="Şiddet" error={form.formState.errors.severity}>
            <Controller
              control={form.control}
              name="severity"
              render={({ field }) => (
                <Select value={field.value || ""} onValueChange={(v) => field.onChange(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Yok" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(defectSeverityLabels).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField label="Açıklama" htmlFor="description" error={form.formState.errors.description}>
            <Input id="description" {...form.register("description")} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isDefault")} /> Varsayılan hata tipi
            <span className="text-xs text-muted-foreground">
              — tablette tipi seçilmeyen hata bu tipe yazılır; kurulumda tek varsayılan olur, işaretlemek eskisini kaldırır
            </span>
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
