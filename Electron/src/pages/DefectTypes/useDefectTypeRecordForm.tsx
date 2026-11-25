// Hata tipi seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → Hata Tipleri ekranı): ekranla aynı form + aynı gövde.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { useKaliteGuvenceEnabled } from "@/hooks/usePricingEnabled";
import { DefectTypeFormDialog } from "./DefectTypeFormDialog";
import { buildPayload } from "./schema";
import { defectTypeService } from "./service";
import type { DefectType } from "./types";

export function useDefectTypeRecordForm(): RecordFormSpec<DefectType> {
  const fourPoint = useKaliteGuvenceEnabled();
  return useMemo<RecordFormSpec<DefectType>>(() => ({
    entityName: "Hata tipi",
    service: defectTypeService,
    writePermission: "quality:write", // Hata Tipleri ekranı ile aynı
    invalidateKeys: ["defect-types"],
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    cardPath: (t) => `/definitions/defect-types?search=${encodeURIComponent(t.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <DefectTypeFormDialog
        fourPoint={fourPoint}
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as Partial<DefectType> | null}
        isSubmitting={isSubmitting}
        onSubmit={(v) => onSubmit(buildPayload(v, initial, fourPoint))}
      />
    ),
  }), [fourPoint]);
}
