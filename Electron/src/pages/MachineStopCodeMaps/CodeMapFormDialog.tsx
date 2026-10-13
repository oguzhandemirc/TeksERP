// Eşleme formu — kart tipi · ham kod · kapsam (seçici modal: kart tipi geneli ya da tek tezgah) · sebep (seçici
// modal). Düzenlemede anahtar salt-okunur, yalnız sebep değişir; yanlış anahtar pasife alınıp yenisi açılır.
import { useQuery } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { loadAllForPicker } from "@/lib/picker-loader";
import { machineService } from "@/pages/Machines/service";
import { OptionPickerField, type PickerOption } from "@/pages/LoomAlarmDuty/OptionPickerModal";
import { useStopReasonPresets } from "@/pages/Operations/MachineStops/useStopReasonPresets";
import { SCOPE_ALL, codeMapFormSchema, formDefaults, selectableReasons, type CodeMapFormValues } from "./code-map-model";
import type { MachineStopCodeMap } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MachineStopCodeMap | null;
  onSubmit: (values: CodeMapFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

function useOptions(open: boolean, initial: MachineStopCodeMap | null) {
  const machines = useQuery({
    queryKey: ["machines", "stop-code-map-picker"],
    queryFn: () => loadAllForPicker(machineService, { filters: { isActive: "true" }, sortBy: "code" }),
    enabled: open && !initial,
    staleTime: 60_000,
  });
  const { active } = useStopReasonPresets();
  const scopes: PickerOption[] = [
    { id: SCOPE_ALL, label: "Kart tipi geneli (tüm tezgahlar)" },
    ...(machines.data?.data ?? []).map((m) => ({ id: m.id, label: `${m.code} — ${m.name}`, subLabel: "Bu tezgah için üst-yazım" })),
  ];
  const reasons: PickerOption[] = selectableReasons(active).map((p) => ({ id: p.id, label: p.label, subLabel: p.code }));
  const cur = initial?.stopReason;
  if (cur && !reasons.some((r) => r.id === cur.id)) reasons.unshift({ id: cur.id, label: cur.label, subLabel: cur.code, warning: "Seçilemez (pasif ya da kayıp sınıfı yok) — başka sebep seçin" });
  return { scopes, reasons };
}

export function CodeMapFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const { scopes, reasons } = useOptions(open, initial);
  const locked = initial !== null;
  return (
    <EntityFormDialog<CodeMapFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Eşlemeyi Düzenle" : "Yeni Kod Eşlemesi"}
      description={locked ? "Kart tipi, ham kod ve kapsam değişmez; yanlışsa eşlemeyi pasife alıp yenisini açın." : "Kartın bildirdiği ham kod bu sebebe çözülür; tezgah eşlemesi kart tipi eşlemesini ezer."}
      schema={codeMapFormSchema}
      defaultValues={formDefaults(initial)}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FormField label="Kart tipi" htmlFor="map-type" error={form.formState.errors.collectorType} required hint="Makine Kartları ekranındaki kart tipiyle birebir (örn. TEKS-ESP32-V1).">
            <Input id="map-type" className="font-mono" disabled={locked} autoFocus={!locked} placeholder="TEKS-ESP32-V1" {...form.register("collectorType", { setValueAs: (v: string) => v.toUpperCase() })} />
          </FormField>
          <FormField label="Ham duruş kodu" htmlFor="map-code" error={form.formState.errors.rawStopCode} required hint="Kontrolcünün gönderdiği kod; harf duyarlı.">
            <Input id="map-code" className="font-mono" disabled={locked} placeholder="E12" {...form.register("rawStopCode")} />
          </FormField>
          <FormField label="Kapsam" required>
            {locked ? (
              <p className="text-sm">{initial?.machine ? `${initial.machine.code} — ${initial.machine.name}` : "Kart tipi geneli (tüm tezgahlar)"}</p>
            ) : (
              <Controller control={form.control} name="scope" render={({ field }) => (
                <OptionPickerField value={field.value} onChange={field.onChange} options={scopes} title="Kapsam seç" placeholder="Kapsam seç" />
              )} />
            )}
          </FormField>
          <FormField label="Duruş sebebi" error={form.formState.errors.stopReasonId} required>
            <Controller control={form.control} name="stopReasonId" render={({ field }) => (
              <OptionPickerField value={field.value || null} onChange={field.onChange} options={reasons} title="Duruş sebebi seç" placeholder="Sebep seç" />
            )} />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
