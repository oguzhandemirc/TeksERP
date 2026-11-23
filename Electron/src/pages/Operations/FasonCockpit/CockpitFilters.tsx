// Filtre kutuları (tek satır): termin durumu · firma (doğrudan modal) · süreç türü (doğrudan modal). Süzme sunucuda;
// değerler/sorgu değişmedi, yalnız görünüm ortak kutulara taşındı (UI D2-d).
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SubcontractorCategory } from "@/pages/SubcontractorCategories/types";
import { STATE_LABEL } from "./cockpit-labels";
import { COCKPIT_STATES, type CockpitFilter, type CockpitState } from "./types";

/** Modal açan seçici tetiği çip görünümünde ("Firma: Tümü") — satırın diğer kutularıyla aynı boy. */
const PICKER = "h-8 min-h-8 w-auto max-w-56 gap-1 px-2.5 py-0 text-xs font-normal [&>span:first-child]:font-normal [&>span:first-child]:text-muted-foreground";
const STATE_OPTIONS = COCKPIT_STATES.map((s) => ({ value: s, label: STATE_LABEL[s] }));

export function CockpitFilters({ filter, onChange }: { filter: CockpitFilter; onChange: (f: CockpitFilter) => void }) {
  const set = (patch: Partial<CockpitFilter>) => onChange({ ...filter, ...patch });
  return (
    <>
      <SelectChip<CockpitState> id="cockpit-state" label="Termin" value={filter.state} options={STATE_OPTIONS} resetValue="ALL" onChange={(v) => set({ state: v ?? "ALL" })} />
      <EntityPickerModal<Subcontractor>
        value={filter.subcontractorId}
        onChange={(id) => set({ subcontractorId: id })}
        service={subcontractorService}
        queryKey="subcontractors-cockpit-filter"
        getLabel={(s) => s.name}
        getSubLabel={(s) => s.code}
        nullable
        noneLabel="Tüm firmalar"
        label="Firma:"
        placeholder="Tümü"
        title="Fason firma seç"
        countLabel="firma"
        triggerClassName={PICKER}
        placeholderClassName="text-foreground"
        hideChevron
      />
      <EntityPickerModal<SubcontractorCategory>
        value={filter.categoryId}
        onChange={(id) => set({ categoryId: id })}
        service={subcontractorCategoryService}
        queryKey="subcontractor-categories-cockpit-filter"
        getLabel={(c) => c.name}
        getSubLabel={(c) => c.code}
        nullable
        noneLabel="Tüm süreç türleri"
        label="Süreç türü:"
        placeholder="Tümü"
        title="Süreç türü seç"
        countLabel="tür"
        triggerClassName={PICKER}
        placeholderClassName="text-foreground"
        hideChevron
      />
    </>
  );
}
