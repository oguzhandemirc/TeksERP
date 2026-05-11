import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import { stationKindLabels, stationTypeLabels, StationType, type StationKind } from "@/types/enums";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { SubcontractorCategory } from "@/pages/SubcontractorCategories/types";
import { stationFormDefaults, stationFormSchema, type StationFormValues } from "./schema";
import type { Station } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Station | null;
  onSubmit: (values: StationFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function StationFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: StationFormValues = initial
    ? {
        name: initial.name,
        type: initial.type,
        kind: initial.kind,
        department: initial.department ?? "",
        isActive: initial.isActive,
        defaultCategoryId: initial.defaultCategoryId ?? null,
      }
    : stationFormDefaults;

  return (
    <EntityFormDialog<StationFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "İstasyonu Düzenle" : "Yeni İstasyon"}
      schema={stationFormSchema}
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
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Tip" error={form.formState.errors.type} required>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <EnumSelect<StationType>
                    value={field.value}
                    onChange={field.onChange}
                    labels={stationTypeLabels}
                  />
                )}
              />
            </FormField>
            <FormField label="Görev Türü" error={form.formState.errors.kind} required>
              <Controller
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <EnumSelect<StationKind>
                    value={field.value}
                    onChange={field.onChange}
                    labels={stationKindLabels}
                  />
                )}
              />
            </FormField>
          </div>
          <FormField label="Departman" htmlFor="department" error={form.formState.errors.department}>
            <Input id="department" placeholder="DOKUMA, TERBIYE..." {...form.register("department")} />
          </FormField>
          {form.watch("type") === StationType.EXTERNAL && (
            <FormField
              label="Varsayılan Fason Kategorisi"
              error={form.formState.errors.defaultCategoryId}
              hint="İş emri oluşturulurken fason planlama modalında otomatik önerilir."
            >
              <Controller
                control={form.control}
                name="defaultCategoryId"
                render={({ field }) => (
                  <ReferenceSelect<SubcontractorCategory>
                    value={field.value}
                    onChange={field.onChange}
                    service={subcontractorCategoryService}
                    queryKey="subcontractor-categories"
                    getLabel={(c) => c.name}
                    placeholder="Kategori seç..."
                    nullable
                    noneLabel="— Atanmadı"
                  />
                )}
              />
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
