// TAHAR PLANLARI (T1) — Tanımlar → Üretim karosu, `dokumaEnabled`. Satırda Düzenle · Örnek al · Pasife al
// (kumaşa bağlı plan pasife alınamaz: sunucu 409 DRAWING_IN_PLAN_IN_USE).
import { CrudPage } from "@/components/layout/CrudPage";
import { drawingInPlanColumns } from "./columns";
import { drawingInPlanService } from "./service";
import { DrawingInPlanFormDialog } from "./DrawingInPlanFormDialog";
import type { DrawingInPlan } from "./types";

export const DRAWING_IN_PLANS_QUERY_KEY = "drawing-in-plans";

export function DrawingInPlansPage() {
  return (
    <CrudPage<DrawingInPlan>
      title="Tahar Planları"
      description="Çözgü tellerinin çerçevelerden geçiş sırası (tahar raporu). Bir plan birden çok kumaşta kullanılır; ürün kartında Çözgü bölümünden seçilir."
      entityName="Tahar planı"
      queryKey={DRAWING_IN_PLANS_QUERY_KEY}
      service={drawingInPlanService}
      columns={drawingInPlanColumns}
      writePermission="warpspec:write"
      searchHint="Kod veya ad"
      copyLabel="Örnek al (yeni plan)"
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting, copyFrom }) => (
        <DrawingInPlanFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          draft={copyFrom}
          isSubmitting={isSubmitting}
          // Yazım gövdesi (kısaltmalı metin) DrawingInPlan satır tipinde değil — CrudPage Partial<T> bekler.
          onSubmit={(body) => onSubmit(body as unknown as Partial<DrawingInPlan>)}
        />
      )}
    />
  );
}
