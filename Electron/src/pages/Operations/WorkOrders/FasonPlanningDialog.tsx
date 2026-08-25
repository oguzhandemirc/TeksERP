import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SubcontractorCategory } from "@/pages/SubcontractorCategories/types";
import type { RouteStep } from "@/pages/Routes/types";
import { fasonNoteLabel } from "./fasonNote";

export interface FasonStepPlan {
  sequence: number;
  stationId: string;
  stationCode: string;
  stationName: string;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
  notes: string;
  /** Fasona renksiz git (2026-08-17 "ekru" kuralı) — çekide "boyanacak renk"
   *  satırı basılmaz; iş emrinin rengi DEĞİŞMEZ. Şablon rotası yolunda bu alan
   *  taşınmazsa kutu işaretlenir ama sunucuya hiç gitmez. */
  dispatchWithoutColor: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Route'tan gelen EXTERNAL adımlar. Sıra korunur. */
  externalSteps: RouteStep[];
  initialPlans: FasonStepPlan[];
  onConfirm: (plans: FasonStepPlan[]) => void;
}

export function buildFasonPlans(
  externalSteps: RouteStep[],
  prior: FasonStepPlan[],
): FasonStepPlan[] {
  const priorBySeq = new Map(prior.map((p) => [p.sequence, p]));
  return externalSteps.map((step) => {
    const existing = priorBySeq.get(step.sequence);
    return existing ?? {
      sequence: step.sequence,
      stationId: step.stationId,
      stationCode: step.station?.code ?? "",
      stationName: step.station?.name ?? "",
      requiredCategoryId: step.station?.defaultCategoryId ?? null,
      plannedSubcontractorId: null,
      notes: step.defaultNotes ?? "",
      dispatchWithoutColor: step.dispatchWithoutColor ?? false,
    };
  });
}

export function FasonPlanningDialog({
  open,
  onOpenChange,
  externalSteps,
  initialPlans,
  onConfirm,
}: Props) {
  const [plans, setPlans] = useState<FasonStepPlan[]>([]);

  useEffect(() => {
    if (open) setPlans(buildFasonPlans(externalSteps, initialPlans));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, externalSteps]);

  const updatePlan = (sequence: number, patch: Partial<FasonStepPlan>) => {
    setPlans((prev) =>
      prev.map((p) => (p.sequence === sequence ? { ...p, ...patch } : p)),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fason Adım Planlaması</DialogTitle>
          <DialogDescription>
            Bu iş emrindeki dış işlem adımları için kategori ve firma tercihi.
            Sevkiyat anında değiştirilebilir.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {plans.map((plan, idx) => (
            <FasonStepCard
              key={plan.sequence}
              plan={plan}
              index={idx}
              onUpdate={(patch) => updatePlan(plan.sequence, patch)}
            />
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            onClick={() => {
              onConfirm(plans);
              onOpenChange(false);
            }}
          >
            Tamam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CardProps {
  plan: FasonStepPlan;
  index: number;
  onUpdate: (patch: Partial<FasonStepPlan>) => void;
}

function FasonStepCard({ plan, index, onUpdate }: CardProps) {
  // Firma listesini kategoriye göre daraltmak için filter — kategori seçiliyse o kategoriyi taşıyan firmalar.
  const subFilter = useMemo(
    () =>
      plan.requiredCategoryId
        ? { categoryId: plan.requiredCategoryId }
        : undefined,
    [plan.requiredCategoryId],
  );

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="muted" className="h-6 w-6 justify-center font-mono">
          {index + 1}
        </Badge>
        <span className="font-medium">{plan.stationName}</span>
        <span className="text-xs text-muted-foreground">({plan.stationCode})</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Sıra {plan.sequence}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Kategori</label>
          <ReferenceSelect<SubcontractorCategory>
            value={plan.requiredCategoryId}
            onChange={(v) => {
              // Kategori değişince firma seçimi resetlenir (eşleşmeyebilir).
              onUpdate({
                requiredCategoryId: v,
                plannedSubcontractorId: null,
              });
            }}
            service={subcontractorCategoryService}
            queryKey="subcontractor-categories"
            getLabel={(c) => c.name}
            placeholder="Kategori seç..."
            nullable
            noneLabel="— Seçilmedi"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Firma</label>
          <ReferenceSelect<Subcontractor>
            value={plan.plannedSubcontractorId}
            onChange={(v) => onUpdate({ plannedSubcontractorId: v })}
            service={subcontractorService}
            queryKey={`subcontractors-${plan.requiredCategoryId ?? "all"}`}
            getLabel={(s) => s.name}
            placeholder="Firma seç..."
            nullable
            noneLabel="— Seçilmedi"
            extraFilters={subFilter}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs text-muted-foreground">
            {fasonNoteLabel(plan.stationName)}
          </label>
          <Input
            value={plan.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            placeholder="Çeki listesine basılır (opsiyonel)"
          />
        </div>
      </div>
    </div>
  );
}
