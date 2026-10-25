import { Controller, type UseFormReturn } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defectSeverityLabels } from "@/types/enums";
import { DEFECT_GROUPS, DEFECT_GROUP_LABELS, UNGROUPED_LABEL } from "@/lib/hata-gruplari";
import { OptionPickerField, type PickerOption } from "@/pages/LoomAlarmDuty/OptionPickerModal";
import { defectTypeFormDefaults, defectTypeFormSchema, type DefectTypeFormValues } from "./schema";
import type { DefectType } from "./types";

import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
// "" = gruplanmamış; seçici doğrudan modal açar (combobox yok — UI tercihi).
const GROUP_OPTIONS: readonly PickerOption[] = [
  { id: "", label: UNGROUPED_LABEL, subLabel: "Raporda ayrı bir grup olarak görünür" },
  ...DEFECT_GROUPS.map((g) => ({ id: g, label: DEFECT_GROUP_LABELS[g] })),
];

function DefectGroupField({ form }: { form: UseFormReturn<DefectTypeFormValues> }) {
  return (
    <FormField
      label="Hata grubu"
      error={form.formState.errors.defectGroup}
      hint="Raporlarda hatalar bu gruba göre toplanır (ör. çözgü × vardiya)."
    >
      <Controller
        control={form.control}
        name="defectGroup"
        render={({ field }) => (
          <OptionPickerField
            value={field.value ?? ""}
            onChange={(v) => field.onChange(v)}
            options={GROUP_OPTIONS}
            title="Hata grubu seç"
            placeholder={UNGROUPED_LABEL}
          />
        )}
      />
    </FormField>
  );
}

const POINT_OPTIONS: readonly PickerOption[] = [
  { id: "", label: "Boyuttan", subLabel: "Hata boyu seçilir: ≤3″ 1 · 3–6″ 2 · 6–9″ 3 · >9″ 4 puan" },
  ...[1, 2, 3, 4].map((n) => ({ id: String(n), label: `${n} puan`, subLabel: "Boyut sorulmaz, her hata bu puanı alır" })),
];

function FixedPointsField({ form }: { form: UseFormReturn<DefectTypeFormValues> }) {
  return (
    <FormField label="4 puan" error={form.formState.errors.fixedPoints} hint="Delik gibi boyu ölçülmeyen hatalarda sabit puan seçin.">
      <Controller
        control={form.control}
        name="fixedPoints"
        render={({ field }) => (
          <OptionPickerField value={field.value ?? ""} onChange={(v) => field.onChange(v)} options={POINT_OPTIONS} title="4 puan seç" placeholder="Boyuttan" />
        )}
      />
    </FormField>
  );
}

interface Props {
  /** Kalite Güvence açık mı — kapalıyken 4 puan alanı hiç çizilmez (bugünkü form). */
  fourPoint?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: DefectType | null;
  onSubmit: (values: DefectTypeFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function DefectTypeFormDialog({ fourPoint = false, open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: DefectTypeFormValues = initial
    ? {
        name: initial.name,
        description: initial.description ?? "",
        severity: (initial.severity ?? "") as DefectTypeFormValues["severity"],
        defectGroup: initial.defectGroup ?? "",
        isActive: initial.isActive,
        isDefault: initial.isDefault,
        fixedPoints: (initial.fixedPoints == null ? "" : String(initial.fixedPoints)) as DefectTypeFormValues["fixedPoints"],
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
          <DefectGroupField form={form} />
          {fourPoint && <FixedPointsField form={form} />}
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
