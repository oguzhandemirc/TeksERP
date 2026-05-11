import { useMemo } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { SubcontractorCategory } from "@/pages/SubcontractorCategories/types";
import type { DesignerStep } from "./RouteDesignerDialog";

interface Props {
  step: DesignerStep;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onStationPick: (id: string | null) => void;
  onUpdate: (patch: Partial<DesignerStep>) => void;
}

export function RouteDesignerStepRow({
  step,
  index,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onStationPick,
  onUpdate,
}: Props) {
  const subFilter = useMemo(
    () =>
      step.requiredCategoryId
        ? { categoryId: step.requiredCategoryId }
        : undefined,
    [step.requiredCategoryId],
  );

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="muted" className="h-6 w-6 justify-center font-mono">
          {index + 1}
        </Badge>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            aria-label="Yukarı"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            aria-label="Aşağı"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            onClick={onRemove}
            aria-label="Sil"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">İstasyon</label>
          <ReferenceSelect<Station>
            value={step.stationId || undefined}
            onChange={onStationPick}
            service={stationService}
            queryKey="stations"
            getLabel={(s) => `${s.name} (${s.code})`}
            placeholder="İstasyon seç..."
          />
          {step.stationType === "EXTERNAL" && (
            <Badge variant="outline" className="mt-0.5 text-[10px]">
              FASON
            </Badge>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Not (opsiyonel)</label>
          <Input
            value={step.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            placeholder="Adıma özel talimat"
          />
        </div>
        {step.stationType === "EXTERNAL" && (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Fason Kategori</label>
              <ReferenceSelect<SubcontractorCategory>
                value={step.requiredCategoryId}
                onChange={(v) =>
                  onUpdate({
                    requiredCategoryId: v,
                    plannedSubcontractorId: null,
                  })
                }
                service={subcontractorCategoryService}
                queryKey="subcontractor-categories"
                getLabel={(c) => c.name}
                placeholder="Kategori seç..."
                nullable
                noneLabel="— Seçilmedi"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Fason Firma</label>
              <ReferenceSelect<Subcontractor>
                value={step.plannedSubcontractorId}
                onChange={(v) => onUpdate({ plannedSubcontractorId: v })}
                service={subcontractorService}
                queryKey={`subcontractors-${step.requiredCategoryId ?? "all"}`}
                getLabel={(s) => s.name}
                placeholder="Firma seç..."
                nullable
                noneLabel="— Seçilmedi"
                extraFilters={subFilter}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
