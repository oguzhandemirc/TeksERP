import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { printerModelService } from "@/pages/PrinterModels/service";
import type { PrinterModel } from "@/pages/PrinterModels/types";
import { labelFormatProfileService } from "@/pages/LabelFormatProfiles/service";
import type { LabelFormatProfile } from "@/pages/LabelFormatProfiles/types";
import {
  machineHardwareFormDefaults,
  machineHardwareFormSchema,
  type MachineHardwareFormValues,
} from "./schema";
import type { MachineHardware } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: MachineHardware | null;
  onSubmit: (values: MachineHardwareFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function MachineHardwareFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: MachineHardwareFormValues = initial
    ? {
        machineId: initial.machineId,
        printerIp: initial.printerIp ?? "",
        printerMac: initial.printerMac ?? "",
        kqMac: initial.kqMac ?? "",
        mtMac: initial.mtMac ?? "",
        mtMac2: initial.mtMac2 ?? "",
        kqPattern: initial.kqPattern ?? "",
        mtPattern: initial.mtPattern ?? "",
        mtPattern2: initial.mtPattern2 ?? "",
        notes: initial.notes ?? "",
        printerModelId: initial.printerModelId ?? "",
        formatProfileId: initial.formatProfileId ?? "",
        isActive: initial.isActive,
      }
    : machineHardwareFormDefaults;

  return (
    <EntityFormDialog<MachineHardwareFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Donanımı Düzenle" : "Yeni Makine Donanımı"}
      schema={machineHardwareFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FormField label="Makine" error={form.formState.errors.machineId} required>
            <Controller
              control={form.control}
              name="machineId"
              render={({ field }) => (
                <ReferenceSelect<Machine>
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? "")}
                  service={machineService}
                  queryKey="machines"
                  getLabel={(m) => `${m.code} — ${m.name}`}
                  placeholder="Makine seç..."
                  disabled={Boolean(initial)}
                />
              )}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Yazıcı IP">
              <Input {...form.register("printerIp")} placeholder="192.168.1.50" />
            </FormField>
            <FormField label="Yazıcı MAC">
              <Input className="font-mono" {...form.register("printerMac")} placeholder="00:23:09:01:15:01" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3">
            <FormField label="Yazıcı Modeli" hint="Bu istasyonun yazıcısı (Argox vb.) — etiket dili buradan.">
              <Controller
                control={form.control}
                name="printerModelId"
                render={({ field }) => (
                  <ReferenceSelect<PrinterModel>
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? "")}
                    service={printerModelService}
                    queryKey="printer-models"
                    getLabel={(m) => `${m.code} — ${m.name}`}
                    placeholder="Model seç..."
                    nullable
                    noneLabel="— (tanımsız)"
                  />
                )}
              />
            </FormField>
            <FormField label="Format Profili" hint="Boş → modelin varsayılan profili.">
              <Controller
                control={form.control}
                name="formatProfileId"
                render={({ field }) => (
                  <ReferenceSelect<LabelFormatProfile>
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? "")}
                    service={labelFormatProfileService}
                    queryKey="label-format-profiles"
                    getLabel={(p) => `${p.code} — ${p.name}`}
                    placeholder="Profil seç..."
                    nullable
                    noneLabel="— (model default)"
                  />
                )}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="KQ MAC">
              <Input className="font-mono" {...form.register("kqMac")} />
            </FormField>
            <FormField label="MT MAC">
              <Input className="font-mono" {...form.register("mtMac")} />
            </FormField>
            <FormField label="MT MAC 2">
              <Input className="font-mono" {...form.register("mtMac2")} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <FormField label="KQ Desen (regex)">
              <Input className="font-mono text-xs" {...form.register("kqPattern")} placeholder="(\d+(?:\.\d+)?)" />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="MT Desen">
                <Input className="font-mono text-xs" {...form.register("mtPattern")} />
              </FormField>
              <FormField label="MT Desen 2">
                <Input className="font-mono text-xs" {...form.register("mtPattern2")} />
              </FormField>
            </div>
          </div>

          <FormField label="Not">
            <Input {...form.register("notes")} placeholder="örn. 2 farklı kantar kullanıldı; A modeli yeni" />
          </FormField>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
