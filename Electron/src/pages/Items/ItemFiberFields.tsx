// K7 iplik kartı "Lif bileşimi": satır = lif + pay (%); toplam tam 100 olmadan Kaydet geçmez (şema), boş liste = girilmemiş.
// Kumaş kompozisyonu bu paylardan hesaplanır (sunucu). Lif listesi Tanımlar › Lif Türleri.
import { Controller, useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { Plus, Spline, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { fiberTypeService } from "@/pages/FabricFiberTypes/service";
import { useClassTypeRecordForm } from "@/pages/FabricFiberTypes/useClassTypeRecordForm";
import type { ClassTypeRow, FiberType } from "@/pages/FabricFiberTypes/types";
import type { CrudService } from "@/services/crudService";
import { cn } from "@/lib/utils";
import type { ItemFormValues } from "./schema";
import { fiberTotal } from "./fabricClass.schema";

const service = fiberTypeService as unknown as CrudService<ClassTypeRow>;

export function ItemFiberFields({ form }: { form: UseFormReturn<ItemFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "fibers" });
  const rows = useWatch({ control: form.control, name: "fibers" }) ?? [];
  const recordForm = useClassTypeRecordForm("fiber");
  const total = fiberTotal(rows);
  const err = form.formState.errors.fibers;
  const listError = err?.message ?? err?.root?.message;

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="item-fiber-fields">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">Lif bileşimi</span>
        <InfoPopover label="Lif bileşimi" desc="Karışım iplikte her lifin payı (ör. %65 Polyester, %35 Pamuk). Toplam tam 100 olmalı. Kumaşın kompozisyonu çözgü ve atkı ipliklerinin bu paylarından hesaplanır." />
        {fields.length > 0 && (
          <span className={cn("ml-auto text-xs tabular-nums", total === 100 ? "text-muted-foreground" : "font-medium text-destructive")} data-testid="item-fiber-total">
            Toplam %{String(total).replace(".", ",")}
          </span>
        )}
      </div>
      {fields.length === 0 && <p className="text-xs text-muted-foreground">Girilmedi — bu ipliği kullanan kumaşın kompozisyonu hesaplanamaz.</p>}
      {fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-[1fr_7rem_2rem] items-start gap-2">
          <Controller
            control={form.control}
            name={`fibers.${i}.fiberTypeId`}
            render={({ field }) => (
              <EntityPickerModal<ClassTypeRow>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={service}
                queryKey="fiber-types"
                getLabel={(t) => t.name}
                getSubLabel={(t) => (t as FiberType).abbreviation}
                sortBy="sortOrder"
                icon={Spline}
                title="Lif seç"
                placeholder="Lif seç"
                countLabel="lif türü"
                recordForm={recordForm}
              />
            )}
          />
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            <Input aria-label="Pay (%)" inputMode="decimal" placeholder="ör. 65" className="pl-6" {...form.register(`fibers.${i}.pct`)} />
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-9 w-8" aria-label="Satırı sil" title="Satırı sil" onClick={() => remove(i)}>
            <X className="h-4 w-4" />
          </Button>
          {(err?.[i]?.fiberTypeId || err?.[i]?.pct) && (
            <p className="col-span-3 text-xs text-destructive">{err?.[i]?.fiberTypeId?.message ?? err?.[i]?.pct?.message}</p>
          )}
        </div>
      ))}
      {listError && <p className="text-xs text-destructive">{listError}</p>}
      <Button type="button" variant="outline" size="sm" onClick={() => append({ fiberTypeId: "", pct: rows.length === 0 ? "100" : "" })}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Lif ekle
      </Button>
    </div>
  );
}
