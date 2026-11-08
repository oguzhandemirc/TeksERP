// Süzgeç şeridi: durum düğmeleri + firma (doğrudan modal) + süreç türü (doğrudan modal). Süzme sunucuda.
import { Building2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SubcontractorCategory } from "@/pages/SubcontractorCategories/types";
import { STATE_LABEL } from "./cockpit-labels";
import { COCKPIT_STATES, type CockpitFilter } from "./types";

export function CockpitFilters({ filter, onChange }: { filter: CockpitFilter; onChange: (f: CockpitFilter) => void }) {
  const set = (patch: Partial<CockpitFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Termin süzgeci">
        {COCKPIT_STATES.map((s) => (
          <Button key={s} size="sm" variant={filter.state === s ? "default" : "outline"} onClick={() => set({ state: s })}>
            {STATE_LABEL[s]}
          </Button>
        ))}
      </div>
      <div className="w-full sm:w-56">
        <EntityPickerModal<Subcontractor>
          value={filter.subcontractorId}
          onChange={(id) => set({ subcontractorId: id })}
          service={subcontractorService}
          queryKey="subcontractors-cockpit-filter"
          getLabel={(s) => s.name}
          getSubLabel={(s) => s.code}
          nullable
          noneLabel="Firma (tümü)"
          placeholder="Firma (tümü)"
          title="Fason firma seç"
          icon={Building2}
          countLabel="firma"
        />
      </div>
      <div className="w-full sm:w-56">
        <EntityPickerModal<SubcontractorCategory>
          value={filter.categoryId}
          onChange={(id) => set({ categoryId: id })}
          service={subcontractorCategoryService}
          queryKey="subcontractor-categories-cockpit-filter"
          getLabel={(c) => c.name}
          getSubLabel={(c) => c.code}
          nullable
          noneLabel="Süreç türü (tümü)"
          placeholder="Süreç türü (tümü)"
          title="Süreç türü seç"
          icon={Workflow}
          countLabel="tür"
        />
      </div>
    </div>
  );
}
