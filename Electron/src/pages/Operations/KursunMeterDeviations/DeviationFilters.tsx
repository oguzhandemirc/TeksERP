// Süzgeç şeridi: durum düğmeleri + makine (doğrudan modal) + müşteri (doğrudan modal) + fabrika günü aralığı. Süzme sunucuda.
import { Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { STATUS_LABEL } from "./deviation-labels";
import { DEVIATION_STATUSES, type DeviationFilter } from "./types";

interface Props {
  filter: DeviationFilter;
  onChange: (f: DeviationFilter) => void;
}

export function DeviationFilters({ filter, onChange }: Props) {
  const set = (patch: Partial<DeviationFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Durum süzgeci">
        <Button size="sm" variant={filter.status === null ? "default" : "outline"} onClick={() => set({ status: null })}>
          Tümü
        </Button>
        {DEVIATION_STATUSES.map((s) => (
          <Button key={s} size="sm" variant={filter.status === s ? "default" : "outline"} onClick={() => set({ status: s })}>
            {STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-56">
          <EntityPickerModal<Machine>
            value={filter.machineId}
            onChange={(id) => set({ machineId: id })}
            service={machineService}
            queryKey="machines-meter-deviation-filter"
            getLabel={(m) => m.name}
            getSubLabel={(m) => m.code}
            nullable
            noneLabel="Makine (tümü)"
            placeholder="Makine (tümü)"
            title="Makine seç"
            icon={Factory}
            countLabel="makine"
          />
        </div>
        <div className="w-full sm:w-56">
          <CustomerPickerField value={filter.customerId} onChange={(id) => set({ customerId: id })} placeholder="Müşteri (tümü)" clearable />
        </div>
        <DateRangeInput from={filter.from} to={filter.to} onFrom={(v) => set({ from: v })} onTo={(v) => set({ to: v })} fromLabel="Başlangıç günü" toLabel="Bitiş günü" inputClassName="h-9" />
      </div>
    </div>
  );
}
