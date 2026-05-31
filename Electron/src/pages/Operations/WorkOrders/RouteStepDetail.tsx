import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import type { DesignerStep } from "./RouteDesignerDialog";

export interface RouteTargetBinding {
  colorId: string | null;
  propertyIds: string[];
  onColor: (id: string | null) => void;
  onProperties: (ids: string[]) => void;
  colorLocked?: boolean;
  lockedPropertyIds?: string[];
}

interface Props {
  step: DesignerStep;
  sequence: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPickStation: (id: string | null) => void;
  onSetNotes: (notes: string) => void;
  onSetFirm: (patch: { plannedSubcontractorId?: string | null }) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  target: RouteTargetBinding;
}

export function RouteStepDetail({
  step,
  sequence,
  canMoveUp,
  canMoveDown,
  onPickStation,
  onSetNotes,
  onSetFirm,
  onMove,
  onRemove,
  target,
}: Props) {
  const isExternal = step.stationType === "EXTERNAL";

  const capQ = useQuery({
    queryKey: ["station-capabilities", step.stationId],
    queryFn: () => stationCapabilityService.getByStation(step.stationId),
    enabled: Boolean(step.stationId),
    staleTime: 300_000,
  });
  const cap = capQ.data?.data;

  const lockedSet = useMemo(
    () => new Set(target.lockedPropertyIds ?? []),
    [target.lockedPropertyIds],
  );
  const selectedProps = useMemo(() => new Set(target.propertyIds), [target.propertyIds]);

  const toggleProp = (id: string) => {
    if (lockedSet.has(id)) return;
    const next = new Set(target.propertyIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    target.onProperties(Array.from(next));
  };
  const pickColor = (id: string) => {
    if (target.colorLocked) return;
    target.onColor(target.colorId === id ? null : id);
  };

  const subFilter = step.requiredCategoryId
    ? { categoryId: step.requiredCategoryId }
    : undefined;

  const appliesNothing =
    !cap ||
    ((!cap.canApplyColor || cap.colors.length === 0) &&
      (!cap.canApplyProperty || cap.properties.length === 0));

  return (
    <div
      className={cn(
        "space-y-3 rounded-md border p-3",
        isExternal
          ? "border-amber-300 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20"
          : "bg-muted/10",
      )}
    >
      <div className="flex items-center gap-2">
        <Badge variant="muted" className="h-5 w-5 justify-center font-mono text-[10px]">
          {sequence}
        </Badge>
        <span className="text-sm font-medium">Adım detayı</span>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label="Sola">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label="Sağa">
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onRemove} aria-label="Sil">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className={isExternal ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : undefined}>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">İstasyon</label>
          <ReferenceSelect<Station>
            value={step.stationId || undefined}
            onChange={onPickStation}
            service={stationService}
            queryKey="stations-wo-step"
            getLabel={(s) => `${s.name} (${s.code})`}
            placeholder="İstasyon seç..."
            extraFilters={{ allowAsWorkOrderStep: "true" }}
          />
        </div>

        {isExternal && (
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Fason Firma</label>
            <ReferenceSelect<Subcontractor>
              value={step.plannedSubcontractorId}
              onChange={(v) => onSetFirm({ plannedSubcontractorId: v })}
              service={subcontractorService}
              queryKey={`subcontractors-${step.requiredCategoryId ?? "all"}`}
              getLabel={(s) => s.name}
              placeholder={step.requiredCategoryId ? "Firma seç..." : "İstasyona kategori atanmamış"}
              nullable
              noneLabel="— Seçilmedi"
              extraFilters={subFilter}
            />
          </div>
        )}
      </div>

      {step.stationId &&
        (capQ.isLoading ? (
          <div className="text-[11px] text-muted-foreground">Yetenekler yükleniyor...</div>
        ) : appliesNothing ? (
          <div className="text-[11px] text-muted-foreground">
            Bu istasyon renk/özellik uygulamaz — sadece işlem yapar.
          </div>
        ) : (
          <div className="space-y-2.5">
            {cap!.canApplyColor && cap!.colors.length > 0 && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Bu istasyonda uygulanan renk
                </label>
                <div className="flex flex-wrap gap-1">
                  {cap!.colors.map((c) => {
                    const on = target.colorId === c.id;
                    return (
                      <Badge
                        key={c.id}
                        variant={on ? "default" : "outline"}
                        className={cn("cursor-pointer gap-1 text-[10px]", target.colorLocked && "cursor-not-allowed opacity-50")}
                        onClick={() => pickColor(c.id)}
                      >
                        {c.hex && (
                          <span className="h-2 w-2 rounded-full border" style={{ backgroundColor: c.hex }} />
                        )}
                        {on && <Check className="h-3 w-3" />}
                        {c.name}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
            {cap!.canApplyProperty && cap!.properties.length > 0 && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Bu istasyonda uygulanan özellikler
                </label>
                <div className="flex flex-wrap gap-1">
                  {cap!.properties.map((p) => {
                    const on = selectedProps.has(p.id);
                    const locked = lockedSet.has(p.id);
                    return (
                      <Badge
                        key={p.id}
                        variant={on ? "default" : "outline"}
                        className={cn("cursor-pointer gap-1 text-[10px]", locked && "cursor-not-allowed opacity-50")}
                        onClick={() => toggleProp(p.id)}
                      >
                        {on && <Check className="h-3 w-3" />}
                        {p.name}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Not (opsiyonel)</label>
        <Input
          value={step.notes}
          onChange={(e) => onSetNotes(e.target.value)}
          placeholder="Adıma özel talimat"
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
