// =============================================================================
// Etiket Stüdyosu — katman (z-sıra) listesi: üstteki eleman en ÖNDE çizilir.
// Üst üste binen/küçük elemanları seçmek + kilitlemek + z-sıra değiştirmek için.
// Sürükle-bırak (dnd-kit) tutamaçtan; ↑↓ butonları erişilebilir yedek olarak kalır.
// =============================================================================

import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Lock, Unlock, ChevronUp, ChevronDown, Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { LabelElement } from "@/types/label-canvas";
import { elementTypeLabels } from "@/types/label-canvas";

interface Props {
  elements: LabelElement[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMoveForward: (id: string) => void;
  onMoveBackward: (id: string) => void;
  onRemove: (id: string) => void;
  /** Sürükle-bırak: fromId'yi toId'nin z-sıra konumuna taşı. */
  onReorder: (fromId: string, toId: string) => void;
}

/** Kısa açıklayıcı — field=bağ/başlık, text=ilk satır, icon=anahtar, aksi=tip adı. */
function describe(el: LabelElement): string {
  if (el.type === "field") return el.label?.trim() ? `${el.label}: ‹${el.bind}›` : `‹${el.bind}›`;
  if (el.type === "text") return el.text.split("\n")[0]?.slice(0, 24) || "(boş metin)";
  if (el.type === "icon") return el.icon;
  return elementTypeLabels[el.type];
}

function LayerRow({ el, selected, onSelect, onToggleLock, onMoveForward, onMoveBackward, onRemove }: {
  el: LabelElement;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMoveForward: (id: string) => void;
  onMoveBackward: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onSelect(el.id)}
      className={cn(
        "group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11px]",
        selected ? "bg-primary/15 text-foreground" : "hover:bg-muted",
        isDragging && "opacity-60",
      )}
    >
      {/* Sürükleme yalnız tutamaçtan → satır tıklaması seçim yapmaya devam eder. */}
      <button type="button" {...attributes} {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 cursor-grab touch-none text-muted-foreground opacity-40 group-hover:opacity-100"
        title="Sürükle → z-sıra">
        <GripVertical className="h-3 w-3" />
      </button>
      <span className="w-14 shrink-0 truncate text-[9px] uppercase text-muted-foreground">
        {elementTypeLabels[el.type]}
      </span>
      <span className="flex-1 truncate">{describe(el)}</span>
      <Button type="button" size="icon" variant="ghost" className="h-5 w-5 shrink-0"
        title={el.locked ? "Kilidi aç" : "Kilitle"}
        onClick={(e) => { e.stopPropagation(); onToggleLock(el.id); }}>
        {el.locked ? <Lock className="h-3 w-3 text-amber-600" /> : <Unlock className="h-3 w-3 text-muted-foreground opacity-40 group-hover:opacity-100" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-5 w-5 shrink-0"
        title="Bir öne (üste)"
        onClick={(e) => { e.stopPropagation(); onMoveForward(el.id); }}>
        <ChevronUp className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-5 w-5 shrink-0"
        title="Bir arkaya (alta)"
        onClick={(e) => { e.stopPropagation(); onMoveBackward(el.id); }}>
        <ChevronDown className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-5 w-5 shrink-0 text-destructive"
        title="Sil"
        onClick={(e) => { e.stopPropagation(); onRemove(el.id); }}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function LayerPanel({ elements, selectedIds, onSelect, onToggleLock, onMoveForward, onMoveBackward, onRemove, onReorder }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  if (elements.length === 0) return null;
  const sel = new Set(selectedIds);
  // Üstte = en önde çizilen (dizinin SONU) → listeyi ters göster.
  const rows = [...elements].reverse();
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Katmanlar ({elements.length})</span>
        <span className="text-[10px] text-muted-foreground">üst = önde · sürükle</span>
      </div>
      <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((el) => el.id)} strategy={verticalListSortingStrategy}>
            {rows.map((el) => (
              <LayerRow key={el.id} el={el} selected={sel.has(el.id)}
                onSelect={onSelect} onToggleLock={onToggleLock}
                onMoveForward={onMoveForward} onMoveBackward={onMoveBackward} onRemove={onRemove} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
