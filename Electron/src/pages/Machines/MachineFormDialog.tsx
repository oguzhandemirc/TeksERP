import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import { machineFormDefaults, machineFormSchema, type MachineFormValues } from "./schema";
import type { Machine } from "./types";

import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Machine | null;
  onSubmit: (values: MachineFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
  /** Kart-içi "Makine ekle" için ön-seçili istasyon (yeni kayıtta). */
  defaultStationId?: string;
}

export function MachineFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting, defaultStationId }: Props) {
  const defaults: MachineFormValues = initial
    ? {
        stationId: initial.stationId,
        name: initial.name,
      }
    : { ...machineFormDefaults, stationId: defaultStationId ?? machineFormDefaults.stationId };

  return (
    <EntityFormDialog<MachineFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Makineyi Düzenle" : "Yeni Makine"}
      schema={machineFormSchema}
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
          <FormField label="İstasyon" error={form.formState.errors.stationId} required>
            <Controller
              control={form.control}
              name="stationId"
              render={({ field }) => (
                <ReferenceSelect<Station>
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? "")}
                  service={stationService}
                  queryKey="stations"
                  getLabel={(s) => `${s.code} — ${s.name}`}
                  placeholder="İstasyon seç..."
                />
              )}
            />
          </FormField>
          <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus {...form.register("name")} />
            {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir. */}
            <SimilarNamesWarning
              entity="machines"
              name={form.watch("name") ?? ""}
              excludeId={initial?.id}
              scope={form.watch("stationId")}
            />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
