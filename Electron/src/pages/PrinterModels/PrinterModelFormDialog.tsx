import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelFormatProfileService } from "@/pages/LabelFormatProfiles/service";
import type { LabelFormatProfile } from "@/pages/LabelFormatProfiles/types";
import { PRINTER_LANGUAGE_LABELS } from "./columns";
import {
  printerModelFormDefaults,
  printerModelFormSchema,
  type PrinterModelFormValues,
} from "./schema";
import type { PrinterLanguage, PrinterModel } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PrinterModel | null;
  onSubmit: (values: PrinterModelFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

const LANGS: PrinterLanguage[] = ["RASTER_HTML", "PPLA", "PPLB", "ZPL"];

export function PrinterModelFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: PrinterModelFormValues = initial
    ? {
        code: initial.code,
        name: initial.name,
        manufacturer: initial.manufacturer ?? "",
        dpi: initial.dpi,
        maxWidthMm: initial.maxWidthMm,
        language: initial.language,
        defaultProfileId: initial.defaultProfileId ?? "",
        isActive: initial.isActive,
      }
    : printerModelFormDefaults;

  return (
    <EntityFormDialog<PrinterModelFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Yazıcı Modelini Düzenle" : "Yeni Yazıcı Modeli"}
      schema={printerModelFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kod" error={form.formState.errors.code} required>
              <Input className="font-mono" {...form.register("code")} placeholder="ARGOX_OS214_PLUS" disabled={Boolean(initial)} />
            </FormField>
            <FormField label="Ad" error={form.formState.errors.name} required>
              <Input {...form.register("name")} placeholder="Argox OS 214 plus" />
            </FormField>
          </div>

          <FormField label="Üretici">
            <Input {...form.register("manufacturer")} placeholder="Argox" />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="DPI" error={form.formState.errors.dpi} required>
              <Input type="number" step="1" min="50" {...form.register("dpi", { valueAsNumber: true })} />
            </FormField>
            <FormField label="Max En (mm)" error={form.formState.errors.maxWidthMm} required>
              <Input type="number" step="1" min="10" {...form.register("maxWidthMm", { valueAsNumber: true })} />
            </FormField>
            <FormField label="Dil" error={form.formState.errors.language} required>
              <Controller
                control={form.control}
                name="language"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGS.map((l) => (
                        <SelectItem key={l} value={l}>{PRINTER_LANGUAGE_LABELS[l]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          <FormField label="Varsayılan Format Profili" hint="Bu modele bağlanan donanım profil seçmezse bu kullanılır.">
            <Controller
              control={form.control}
              name="defaultProfileId"
              render={({ field }) => (
                <ReferenceSelect<LabelFormatProfile>
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? "")}
                  service={labelFormatProfileService}
                  queryKey="label-format-profiles"
                  getLabel={(p) => `${p.code} — ${p.name}`}
                  placeholder="Profil seç..."
                  nullable
                  noneLabel="— (yok)"
                />
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
