// Filtre satırı (tek satır kutular): durum · makine (doğrudan modal) · müşteri (doğrudan modal) · fabrika günü aralığı.
// Süzme sunucuda; değerler/sorgu değişmedi, yalnız görünüm ortak kutulara taşındı (UI D2-d).
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { STATUS_LABEL } from "./deviation-labels";
import { DEVIATION_STATUSES, type DeviationFilter, type DeviationStatus } from "./types";

/** Modal açan seçici tetiği çip görünümünde ("Makine: Tümü") — satırın diğer kutularıyla aynı boy. */
const PICKER = "h-8 min-h-8 w-auto max-w-56 gap-1 px-2.5 py-0 text-xs font-normal [&>span:first-child]:font-normal [&>span:first-child]:text-muted-foreground";
const STATUS_OPTIONS = DEVIATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }));

interface Props {
  filter: DeviationFilter;
  onChange: (f: DeviationFilter) => void;
}

export function DeviationFilters({ filter, onChange }: Props) {
  const set = (patch: Partial<DeviationFilter>) => onChange({ ...filter, ...patch });
  return (
    <>
      <SelectChip<DeviationStatus> id="deviation-status" label="Durum" value={filter.status} options={STATUS_OPTIONS} onChange={(v) => set({ status: v })} />
      <EntityPickerModal<Machine>
        value={filter.machineId}
        onChange={(id) => set({ machineId: id })}
        service={machineService}
        queryKey="machines-meter-deviation-filter"
        getLabel={(m) => m.name}
        getSubLabel={(m) => m.code}
        nullable
        noneLabel="Tüm makineler"
        label="Makine:"
        placeholder="Tümü"
        title="Makine seç"
        countLabel="makine"
        triggerClassName={PICKER}
        placeholderClassName="text-foreground"
        hideChevron
      />
      <CustomerPickerField value={filter.customerId} onChange={(id) => set({ customerId: id })} placeholder="Müşteri: Tümü" clearable triggerClassName="h-8 w-auto max-w-56 text-xs" />
      <DayRangeChip id="deviation-day" label="Gün" from={filter.from} to={filter.to} onChange={({ from, to }) => set({ from, to })} />
    </>
  );
}
