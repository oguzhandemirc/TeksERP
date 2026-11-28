// Ürün penceresi > Çözgü > Tahar planı (T1): planı seçiciden seç; seçicide Yeni · Düzenle (yalnız bu kumaşa ait plan)
// · Örnek al. Altında kısa tel→çerçeve şeridi. Plan boşsa kumaş görünümü desen kartının tahar türünden çizilir.
import { useQuery } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Rows3 } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { DrawingInPreview } from "@/pages/DrawingInPlans/DrawingInPreview";
import { PlanMachinesList } from "@/pages/DrawingInPlans/PlanMachinesList";
import { drawingInPlanService } from "@/pages/DrawingInPlans/service";
import type { DrawingInPlan } from "@/pages/DrawingInPlans/types";
import { useDrawingInPlanRecordForm } from "@/pages/DrawingInPlans/useDrawingInPlanRecordForm";
import type { ItemFormValues } from "../schema";

export function ItemDrawingInSection({ form, savedPlanId }: { form: UseFormReturn<ItemFormValues>; savedPlanId: string | null }) {
  const recordForm = useDrawingInPlanRecordForm(savedPlanId);
  const planId = form.watch("drawingInPlanId");
  const plan = useQuery({
    queryKey: ["drawing-in-plans", "detail", planId],
    queryFn: () => drawingInPlanService.getById(planId).then((r) => r.data),
    enabled: !!planId,
  });
  const p = plan.data;
  return (
    <div className="space-y-3 border-t pt-4" data-testid="item-drawing-in">
      <FormField
        label="Tahar planı"
        error={form.formState.errors.drawingInPlanId}
        info="Her çözgü telinin hangi çerçeveden geçtiğini gösteren tekrar dizisi (örn. 3x(1-2-3-4) 5-6). Seçilirse kumaş görünümü bu plandan çizilir; boşsa desen kartındaki tahar türünden."
      >
        <Controller
          control={form.control}
          name="drawingInPlanId"
          render={({ field }) => (
            <EntityPickerModal<DrawingInPlan>
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? "")}
              service={drawingInPlanService}
              queryKey="drawing-in-plans-item"
              getLabel={(r) => r.name}
              getSubLabel={(r) => `${r.code} · ${r.frameCount} çerçeve · ${r.notation}`}
              icon={Rows3}
              nullable
              noneLabel="Tahar planı yok"
              title="Tahar planı seç"
              placeholder="Tahar planı seç"
              recordForm={recordForm}
            />
          )}
        />
      </FormField>
      {planId && p && (
        <div className="rounded-md border bg-muted/20 p-3 text-sm" data-testid="drawing-in-summary">
          <p className="mb-2">
            <span className="font-medium">{p.name}</span>{" "}
            <span className="font-mono text-xs text-muted-foreground">{p.code} · {p.frameCount} çerçeve · {p.notation}</span>
          </p>
          <DrawingInPreview compact frameCount={p.frameCount} threading={p.threading} />
          <PlanMachinesList planId={p.id} />
        </div>
      )}
    </div>
  );
}
