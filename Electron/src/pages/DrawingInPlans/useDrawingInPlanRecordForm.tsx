// Tahar planı seçicisinin kayıt formu (Yeni · Düzenle · Örnek al): Tahar Planları ekranıyla aynı form + gövde.
// Plan kumaşlar arasında paylaşılır → yerinde Düzenle yalnız başka kumaşta kullanılmayan planda (`isExclusive`).
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { DrawingInPlanFormDialog } from "./DrawingInPlanFormDialog";
import { drawingInPlanService } from "./service";
import type { DrawingInPlan } from "./types";

/** Hiç kumaşta yoksa ya da tek kullanıcısı bu kumaşın kayıtlı planıysa yerinde düzenlenebilir. */
export function isPlanExclusive(row: DrawingInPlan, savedPlanId: string | null | undefined): boolean {
  const n = row._count?.fabricItems;
  if (n === undefined) return false;
  return n === 0 || (n === 1 && !!savedPlanId && row.id === savedPlanId);
}

export function useDrawingInPlanRecordForm(savedPlanId?: string | null): RecordFormSpec<DrawingInPlan> {
  return useMemo<RecordFormSpec<DrawingInPlan>>(() => ({
    entityName: "Tahar planı",
    service: drawingInPlanService,
    writePermission: "warpspec:write", // Tahar Planları ekranı ile aynı
    invalidateKeys: ["drawing-in-plans"],
    // Ad "(kopya)" önerisini form varsayılanı verir; kod seriden doğar.
    templateRule: {},
    isExclusive: (row) => isPlanExclusive(row, savedPlanId),
    cardPath: (p) => `/definitions/drawing-in-plans?search=${encodeURIComponent(p.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => open && (
      <DrawingInPlanFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as Partial<DrawingInPlan> | null}
        isSubmitting={isSubmitting}
        onSubmit={(body) => onSubmit(body as unknown as Partial<DrawingInPlan>)}
      />
    ),
  }), [savedPlanId]);
}
