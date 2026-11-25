import { useMemo, useState } from "react";
import { ListOrdered } from "lucide-react";
import { CrudPage } from "@/components/layout/CrudPage";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useKaliteGuvenceEnabled } from "@/hooks/usePricingEnabled";
import { buildDefectTypeColumns } from "./columns";
import { DefectTypeSortDialog } from "./DefectTypeSortDialog";
import { defectTypeService } from "./service";
import { DefectTypeFormDialog } from "./DefectTypeFormDialog";
import type { DefectType } from "./types";
import { buildPayload } from "./schema";

export function DefectTypesPage() {
  const fourPoint = useKaliteGuvenceEnabled();
  const [sortOpen, setSortOpen] = useState(false);
  const columns = useMemo(() => buildDefectTypeColumns(fourPoint), [fourPoint]);
  return (
    <>
    <CrudPage<DefectType>
      title="Hata Tipleri"
      description="Kalite kontrol hata tanımları."
      entityName="Hata tipi"
      importEntity="defectType"
      queryKey="defect-types"
      service={defectTypeService}
      columns={columns}
      headerExtra={fourPoint ? (
        <PermissionGate permission="quality:write">
          <Button variant="outline" size="sm" onClick={() => setSortOpen(true)}><ListOrdered className="mr-1 h-4 w-4" />Tablet sırası</Button>
        </PermissionGate>
      ) : undefined}
      writePermission="quality:write"
      searchHint="Kod veya ad"
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <DefectTypeFormDialog
          fourPoint={fourPoint}
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPayload(values, initial, fourPoint))}
        />
      )}
    />
    {fourPoint && <DefectTypeSortDialog open={sortOpen} onOpenChange={setSortOpen} />}
    </>
  );
}
