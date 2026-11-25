import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import { useDevereEnabled, useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import { machineFormDefaults, machineFormSchema, type MachineFormValues } from "./schema";
import type { Machine } from "./types";
import { planningToFormText } from "./machinePayload";
import { MachinePlanningSection } from "./MachinePlanningSection";

import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Machine | null;
  /** Seçicide "Örnek al": kimliksiz taslak (yalnız oluşturur). */
  draft?: Partial<Machine> | null;
  onSubmit: (values: MachineFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
  /** Kart-içi "Makine ekle" için ön-seçili istasyon (yeni kayıtta). */
  defaultStationId?: string;
}

export function MachineFormDialog({ open, onOpenChange, initial, draft, onSubmit, isSubmitting, defaultStationId }: Props) {
  // Yuva alanı yalnız devere modülü açıkken çizilir (kapalıyken form BİREBİR eski, değer 1 gider).
  const devereEnabled = useDevereEnabled();
  // Planlama (devir/verim/en) yalnız dokuma tezgâhında anlamlı — modül kapalıyken bölüm yok (bugünkü form).
  const dokumaEnabled = useDokumaEnabled();
  // Örnek al taslağı (kimliksiz) düzenleme değerleriyle aynı yoldan dolar; kayıt yine yalnız oluşturur.
  const src = initial ?? draft;
  const defaults: MachineFormValues = src
    ? {
        stationId: src.stationId ?? machineFormDefaults.stationId,
        name: src.name ?? "",
        warpBeamSlots: src.warpBeamSlots ?? 1,
        planRpm: planningToFormText(src.planRpm),
        planEfficiencyPct: planningToFormText(src.planEfficiencyPct),
        maxWorkingWidthCm: planningToFormText(src.maxWorkingWidthCm),
      }
    : { ...machineFormDefaults, stationId: defaultStationId ?? machineFormDefaults.stationId };

  return (
    <EntityFormDialog<MachineFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Makineyi Düzenle" : draft ? "Yeni Makine (örnekten)" : "Yeni Makine"}
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
          {devereEnabled && (
            <FormField label="Levent yuva sayısı" htmlFor="warpBeamSlots" error={form.formState.errors.warpBeamSlots} hint="Levent tüketen istasyondaki makinede kaç levent aynı anda takılı olabilir (0 = cağlıklı çözgü makinesi).">
              <Input id="warpBeamSlots" type="number" min={0} max={32} step={1} {...form.register("warpBeamSlots")} />
            </FormField>
          )}
          {dokumaEnabled && <MachinePlanningSection form={form} hasSavedValues={Boolean(defaults.planRpm || defaults.planEfficiencyPct || defaults.maxWorkingWidthCm)} />}
        </>
      )}
    </EntityFormDialog>
  );
}
