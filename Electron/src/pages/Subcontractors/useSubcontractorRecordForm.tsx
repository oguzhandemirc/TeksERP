// Fason firma seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → bağlı cari kartı): cari kartındaki
// "fason profilini düzenle" ile aynı form + aynı gövde. Fason profili ortak kayıttır → seçicide yerinde düzenlenmez.
import { Suspense, lazy, useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { subcontractorService } from "./service";
import { buildSubcontractorPayload } from "./subcontractorPayload";
// Tembel: form ücret/iplik bölümlerini taşır; ortak seçici (SubcontractorCategoryPicker) onu statik zincire sokmasın.
const SubcontractorFormDialog = lazy(() => import("./SubcontractorFormDialog").then((m) => ({ default: m.SubcontractorFormDialog })));
import type { Subcontractor } from "./types";

export function useSubcontractorRecordForm(): RecordFormSpec<Subcontractor> {
  return useMemo<RecordFormSpec<Subcontractor>>(() => ({
    entityName: "Fason firma",
    service: subcontractorService,
    writePermission: "subcontractor:write", // backend /api/subcontractors POST ile aynı
    invalidateKeys: ["subcontractors"],
    templateRule: { clear: ["code", "taxNumber"], suggestCopy: ["name"] },
    // Fason ekranı kalktı (T1/T9): profil bağlı cari kartından düzenlenir.
    cardPath: (s) => (s.customerId ? `/definitions/cariler/${s.customerId}` : `/definitions/cariler?search=${encodeURIComponent(s.name)}`),
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => open && (
      <Suspense fallback={null}><SubcontractorFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as Partial<Subcontractor> | null}
        isSubmitting={isSubmitting}
        onSubmit={(v) => onSubmit(buildSubcontractorPayload(v, initial) as unknown as Partial<Subcontractor>)}
      /></Suspense>
    ),
  }), []);
}
