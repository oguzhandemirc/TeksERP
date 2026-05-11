import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import { qualityGradeFormDefaults, qualityGradeFormSchema, type QualityGradeFormValues } from "./schema";
import type { QualityGrade } from "./types";

const TARGET_STATUS_LABELS: Record<QualityGradeFormValues["targetStatus"], string> = {
  WAREHOUSE: "Depoya (1. Kalite ana ürün)",
  A1_STOCK: "A1 Stok (alt kalite satılabilir)",
  SCRAP: "Fire (hurda — atılır)",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: QualityGrade | null;
  onSubmit: (values: QualityGradeFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function QualityGradeFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: QualityGradeFormValues = initial
    ? {
        name: initial.name,
        description: initial.description ?? "",
        color: initial.color ?? "",
        sortOrder: initial.sortOrder,
        isActive: initial.isActive,
        targetStatus: initial.targetStatus,
      }
    : qualityGradeFormDefaults;

  return (
    <EntityFormDialog<QualityGradeFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Kalite Sınıfını Düzenle" : "Yeni Kalite Sınıfı"}
      schema={qualityGradeFormSchema}
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
              <Input id="name" autoFocus placeholder="A1, A2, Fire..." {...form.register("name")} />
            </FormField>
            <FormField label="Sıra" htmlFor="sortOrder" error={form.formState.errors.sortOrder} required>
              <Input id="sortOrder" type="number" min={0} {...form.register("sortOrder")} />
            </FormField>
          </div>
          <FormField
            label="Renk"
            error={form.formState.errors.color}
            hint="UI rozetinde gözükecek renk. Hex yaz veya paletten seç."
          >
            <Controller
              control={form.control}
              name="color"
              render={({ field }) => (
                <ColorPickerInput value={field.value ?? ""} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField
            label="Hedef Durum"
            error={form.formState.errors.targetStatus}
            required
            hint="Tambur'da bu kalite seçilince çocuk top hangi statüye geçer. Yanlış seçim toplar fire'a düşmesine yol açar."
          >
            <Controller
              control={form.control}
              name="targetStatus"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TARGET_STATUS_LABELS).map(([k, l]) => (
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
        </>
      )}
    </EntityFormDialog>
  );
}
