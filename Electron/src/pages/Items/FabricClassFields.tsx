// K8 kumaş kartı: kumaş türü (ayarlanabilir liste, ortak seçici sözleşmesi) + yanmazlık (kapalı küme; boş = belirtilmemiş).
import { Controller, type UseFormReturn } from "react-hook-form";
import { Layers } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { fabricTypeService } from "@/pages/FabricFiberTypes/service";
import { useClassTypeRecordForm } from "@/pages/FabricFiberTypes/useClassTypeRecordForm";
import type { ClassTypeRow } from "@/pages/FabricFiberTypes/types";
import type { CrudService } from "@/services/crudService";
import type { ItemFormValues } from "./schema";
import { FLAME_OPTIONS } from "./fabricClass.schema";

type FlameKey = "UNSET" | (typeof FLAME_OPTIONS)[number]["value"];
const FLAME_LABELS = { UNSET: "Belirtilmemiş", ...Object.fromEntries(FLAME_OPTIONS.map((o) => [o.value, o.label])) } as Record<FlameKey, string>;

export function FabricClassFields({ form }: { form: UseFormReturn<ItemFormValues> }) {
  const recordForm = useClassTypeRecordForm("fabric");
  return (
    <>
      <FormField label="Kumaş türü" error={form.formState.errors.fabricTypeId} info="Tül, Fon, Blackout gibi tür. Liste Tanımlar › Kumaş Türleri'nden yönetilir.">
        <Controller
          control={form.control}
          name="fabricTypeId"
          render={({ field }) => (
            <EntityPickerModal<ClassTypeRow>
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? "")}
              service={fabricTypeService as unknown as CrudService<ClassTypeRow>}
              queryKey="fabric-types"
              getLabel={(t) => t.name}
              sortBy="sortOrder"
              icon={Layers}
              nullable
              noneLabel="Tür yok"
              title="Kumaş türü seç"
              placeholder="Kumaş türü seç"
              countLabel="kumaş türü"
              recordForm={recordForm}
            />
          )}
        />
      </FormField>
      <FormField label="Yanmazlık" error={form.formState.errors.flameRetardancy} info="Kumaşın yanmazlık sınıfı. Boş bırakılırsa belirtilmemiş sayılır.">
        <Controller
          control={form.control}
          name="flameRetardancy"
          render={({ field }) => (
            <EnumSelect<FlameKey>
              value={(field.value || "UNSET") as FlameKey}
              onChange={(v) => field.onChange(v === "UNSET" ? "" : v)}
              labels={FLAME_LABELS}
            />
          )}
        />
      </FormField>
    </>
  );
}
