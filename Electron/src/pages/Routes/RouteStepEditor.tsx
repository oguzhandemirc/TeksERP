import { useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { RouteStepTargets } from "./RouteStepTargets";
import { newClientId, type RouteStepFormValues } from "./schema";

interface Props {
  value: RouteStepFormValues[];
  onChange: (next: RouteStepFormValues[]) => void;
  error?: string;
}

// Favori (isFavorite) firmaları getir — client-side kategoriye göre eşleşir.
async function fetchFavoriteFirms(qc: QueryClient): Promise<Subcontractor[]> {
  try {
    const res = await qc.fetchQuery({
      queryKey: ["subcontractors", "favorites"],
      queryFn: () =>
        subcontractorService.getAll({
          page: 1,
          pageSize: 100,
          sortBy: "name",
          sortOrder: "asc",
          filters: { isFavorite: "true", isActive: "true" },
        }),
      staleTime: 60_000,
    });
    return res.data ?? [];
  } catch {
    return [];
  }
}

function pickFavoriteFirmId(favs: Subcontractor[], categoryId: string): string | null {
  return (
    favs.find((f) => f.isFavorite && f.categories.some((c) => c.categoryId === categoryId))?.id ??
    null
  );
}

export function RouteStepEditor({ value, onChange, error }: Props) {
  const qc = useQueryClient();
  // Async istasyon seçiminde (fetch sonrası) güncel listeyi okumak için ayna ref.
  const valueRef = useRef(value);
  valueRef.current = value;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = value.findIndex((s) => s.clientId === active.id);
    const newIdx = value.findIndex((s) => s.clientId === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(value, oldIdx, newIdx));
  };

  const updateStep = (clientId: string, patch: Partial<RouteStepFormValues>) => {
    onChange(valueRef.current.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)));
  };

  const removeStep = (clientId: string) => {
    onChange(value.filter((s) => s.clientId !== clientId));
  };

  const addStep = () => {
    onChange([
      ...value,
      { clientId: newClientId(), stationId: "", defaultNotes: "" },
    ]);
  };

  // İstasyon seçimi: tip + (EXTERNAL ise) varsayılan kategori + favori fason firmasını çöz.
  const handleStationPick = async (clientId: string, stationId: string | null) => {
    // İstasyon değişince şablon hedefi SIFIRLANIR: özellik istasyona bağlı bir
    // yetenektir, eski istasyonun özelliği yenisinde geçersizdir (backend 400
    // döner) ve renk de artık başka bir adımın kararıdır. Sessizce taşımak,
    // kaydet'e basınca anlaşılmaz bir hata üretirdi.
    const clearTargets = { plannedColorId: null, plannedPropertyIds: [] };
    if (!stationId) {
      updateStep(clientId, {
        stationId: "",
        stationType: undefined,
        requiredCategoryId: null,
        plannedSubcontractorId: null,
        ...clearTargets,
      });
      return;
    }
    updateStep(clientId, { stationId, ...clearTargets }); // seçimi anında yansıt
    try {
      const res = await qc.fetchQuery({
        queryKey: ["station", stationId, "route-step"],
        queryFn: () => stationService.getById(stationId),
        staleTime: 5 * 60_000,
      });
      const station = res.data;
      if (!station) return;
      const isExternal = station.type === "EXTERNAL";
      const requiredCategoryId = isExternal ? station.defaultCategoryId ?? null : null;
      // Fason adımıysa kategorinin favori firmasını default seç.
      let plannedSubcontractorId: string | null = null;
      if (isExternal && requiredCategoryId) {
        plannedSubcontractorId = pickFavoriteFirmId(await fetchFavoriteFirms(qc), requiredCategoryId);
      }
      updateStep(clientId, { stationType: station.type, requiredCategoryId, plannedSubcontractorId });
    } catch {
      toast.error("İstasyon bilgisi yüklenemedi.");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Adımlar ({value.length})
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addStep} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Adım Ekle
        </Button>
      </div>

      {value.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          Henüz adım yok. <span className="ml-1 underline cursor-pointer" onClick={addStep}>Ekle</span>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value.map((s) => s.clientId)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {value.map((step, index) => (
                <StepRow
                  key={step.clientId}
                  step={step}
                  index={index}
                  onStationPick={(v) => handleStationPick(step.clientId, v)}
                  onUpdate={(patch) => updateStep(step.clientId, patch)}
                  onRemove={() => removeStep(step.clientId)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface RowProps {
  step: RouteStepFormValues;
  index: number;
  onStationPick: (stationId: string | null) => void;
  onUpdate: (patch: Partial<RouteStepFormValues>) => void;
  onRemove: () => void;
}

function StepRow({ step, index, onStationPick, onUpdate, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.clientId,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 rounded-md border bg-card p-2 ${isDragging ? "ring-2 ring-ring" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Sürükle"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <Badge variant="muted" className="mt-1 h-6 w-6 justify-center font-mono">
        {index + 1}
      </Badge>

      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-1">
          <ReferenceSelect<Station>
            value={step.stationId || undefined}
            onChange={onStationPick}
            service={stationService}
            queryKey="stations-route-step"
            getLabel={(s) => `${s.code} — ${s.name}`}
            placeholder="İstasyon seç..."
            extraFilters={{ allowAsWorkOrderStep: "true" }}
          />
          {step.stationType === "EXTERNAL" && (
            <Badge variant="outline" className="text-[10px]">
              FASON
            </Badge>
          )}
        </div>
        <Input
          value={step.defaultNotes ?? ""}
          onChange={(e) => onUpdate({ defaultNotes: e.target.value })}
          placeholder="Bu adıma özel not (opsiyonel)"
          className="text-sm"
        />

        {/* Fason firma — yalnız EXTERNAL adımda; varsayılan favori firma seçilir.
            Hedeften ÖNCE: "işi kim yapıyor" sorusu "ne kazandırıyor"dan önce gelir. */}
        {step.stationType === "EXTERNAL" && (
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs text-muted-foreground">
              Fason Firma <span className="text-muted-foreground/70">(varsayılan: favori)</span>
            </label>
            <ReferenceSelect<Subcontractor>
              value={step.plannedSubcontractorId ?? null}
              onChange={(v) => onUpdate({ plannedSubcontractorId: v })}
              service={subcontractorService}
              queryKey={`subcontractors-${step.requiredCategoryId ?? "all"}`}
              getLabel={(s) => s.name}
              placeholder="Firma seç..."
              nullable
              noneLabel="— Seçilmedi"
              extraFilters={step.requiredCategoryId ? { categoryId: step.requiredCategoryId } : undefined}
            />
          </div>
        )}

        {/* Adımın şablon hedefi (renk + özellik) — istasyon seçilince çıkar.
            Ayrı dosyada: yetenek sorgusu + iki koşullu blok bu satırı 300 satır
            kuralının üstüne taşıyordu. */}
        {step.stationId && (
          <div className="sm:col-span-2">
            <RouteStepTargets
              stationId={step.stationId}
              colorId={step.plannedColorId ?? null}
              propertyIds={step.plannedPropertyIds ?? []}
              onColor={(id) => onUpdate({ plannedColorId: id })}
              onProperties={(ids) => onUpdate({ plannedPropertyIds: ids })}
            />
          </div>
        )}
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="mt-0.5 h-7 w-7 text-destructive"
        onClick={onRemove}
        aria-label="Adımı sil"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
