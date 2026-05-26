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
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import { newClientId, type RouteStepFormValues } from "./schema";

interface Props {
  value: RouteStepFormValues[];
  onChange: (next: RouteStepFormValues[]) => void;
  error?: string;
}

export function RouteStepEditor({ value, onChange, error }: Props) {
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
    onChange(value.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)));
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
  onUpdate: (patch: Partial<RouteStepFormValues>) => void;
  onRemove: () => void;
}

function StepRow({ step, index, onUpdate, onRemove }: RowProps) {
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
        <ReferenceSelect<Station>
          value={step.stationId || undefined}
          onChange={(v) => onUpdate({ stationId: v ?? "" })}
          service={stationService}
          queryKey="stations-route-step"
          getLabel={(s) => `${s.code} — ${s.name}`}
          placeholder="İstasyon seç..."
          extraFilters={{ allowAsWorkOrderStep: "true" }}
        />
        <Input
          value={step.defaultNotes ?? ""}
          onChange={(e) => onUpdate({ defaultNotes: e.target.value })}
          placeholder="Bu adıma özel not (opsiyonel)"
          className="text-sm"
        />
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
