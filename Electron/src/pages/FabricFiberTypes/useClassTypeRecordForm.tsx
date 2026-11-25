// Kumaş/lif türü seçicisinin kayıt formu: Yeni + Örnek al serbest; tür paylaşılan kayıttır → Düzenle "Kart ekranında aç".
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { ClassTypeFormDialog } from "./ClassTypeFormDialog";
import { CLASS_TYPE_KINDS, type ClassTypeKind } from "./kinds";
import { classTypePayload } from "./schema";
import type { ClassTypeRow } from "./types";

export function useClassTypeRecordForm(kind: ClassTypeKind): RecordFormSpec<ClassTypeRow> {
  return useMemo<RecordFormSpec<ClassTypeRow>>(() => {
    const cfg = CLASS_TYPE_KINDS[kind];
    return {
      entityName: cfg.entity,
      service: cfg.service,
      writePermission: "item:write", // tanım ekranı ve backend fabric-fiber-type.routes ile aynı
      invalidateKeys: [cfg.queryKey],
      templateRule: { suggestCopy: ["name"], clear: ["abbreviation"] },
      isExclusive: () => false,
      cardPath: (r) => `/definitions/${cfg.queryKey}?search=${encodeURIComponent(r.name)}`,
      renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
        <ClassTypeFormDialog
          kind={kind}
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          draft={draft as Partial<ClassTypeRow> | null}
          isSubmitting={isSubmitting}
          onSubmit={(v) => onSubmit(classTypePayload(cfg.hasAbbreviation, v) as Partial<ClassTypeRow>)}
        />
      ),
    };
  }, [kind]);
}
