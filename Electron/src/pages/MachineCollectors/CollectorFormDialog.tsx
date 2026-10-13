// Kart kayıt / düzenleme formu — ad · kart tipi · bağlı tezgahlar (bir tezgahın tek kartı olur; sunucu 409 der).
// Kart tipi ham kod eşlemesinin anahtarıdır (Duruş Kodu Eşleme ekranındaki tip ile BİREBİR yazılır).
import { useQuery } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { MultiSelectCheckboxList } from "@/components/forms/MultiSelectCheckboxList";
import { Input } from "@/components/ui/input";
import { loadAllForPicker } from "@/lib/picker-loader";
import { machineService } from "@/pages/Machines/service";
import { collectorFormSchema, type CollectorFormValues } from "./collector-model";
import type { MachineCollector } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MachineCollector | null;
  onSubmit: (values: CollectorFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function CollectorFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const machines = useQuery({
    queryKey: ["machines", "collector-picker"],
    queryFn: () => loadAllForPicker(machineService, { filters: { isActive: "true" }, sortBy: "code" }),
    enabled: open,
    staleTime: 60_000,
  });
  const items = (machines.data?.data ?? []).map((m) => ({ id: m.id, label: `${m.code} — ${m.name}`, group: m.station?.name }));
  const defaults: CollectorFormValues = initial
    ? { name: initial.name, collectorType: initial.collectorType ?? "", machineIds: initial.machines.map((m) => m.machine.id) }
    : { name: "", collectorType: "", machineIds: [] };
  return (
    <EntityFormDialog<CollectorFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Kartı Düzenle" : "Yeni Kart Kaydı"}
      description={initial ? undefined : "Kayıttan sonra kartın sırrı bir kez gösterilir."}
      schema={collectorFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
      submitLabel={initial ? "Kaydet" : "Kaydet ve sırrı göster"}
    >
      {(form) => (
        <>
          <FormField label="Kart adı" htmlFor="collector-name" error={form.formState.errors.name} required>
            <Input id="collector-name" autoFocus placeholder="Hol A — 1. pano" {...form.register("name")} />
          </FormField>
          <FormField label="Kart tipi" htmlFor="collector-type" error={form.formState.errors.collectorType} required hint="Ham kod eşlemesi bu tipe göre çözülür (örn. TEKS-ESP32-V1).">
            <Input id="collector-type" className="font-mono" placeholder="TEKS-ESP32-V1" {...form.register("collectorType", { setValueAs: (v: string) => v.toUpperCase() })} />
          </FormField>
          <FormField label="Bağlı tezgahlar" error={form.formState.errors.machineIds} required>
            <Controller
              control={form.control}
              name="machineIds"
              render={({ field }) => (
                <MultiSelectCheckboxList items={items} value={field.value} onChange={field.onChange} placeholder="Tezgah ara…" emptyHint={machines.isLoading ? "Yükleniyor…" : "Aktif tezgah yok."} />
              )}
            />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
