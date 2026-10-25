import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockOutcome } from "../custom-api";
import { BlockBody } from "../DefinitionResultView";
import { GRID_SPAN_CLASS } from "./grid-classes";
import { KIND_LABEL, type DefinitionBlock, type LayoutItem } from "./layout-model";

interface Props {
  items: Array<{ block: DefinitionBlock; item: LayoutItem }>;
  outcomes: Map<string, BlockOutcome>;
  selectedId: string | null;
  chartKindOf: (id: string) => string;
  onSelect: (id: string) => void;
  onMove: (activeId: string, overId: string) => void;
  onShift: (id: string, delta: -1 | 1) => void;
}

/**
 * Düzen tuvali: 12 sütunluk ızgarada GERÇEK veriyle çizilmiş bloklar. Yalnız ⠿ tutamacı sürükler
 * (kartın kendisine tık seçer); ↑↓ düğmeleri klavye/erişilebilirlik yedeği. Dar ekranda tek sütun.
 */
export function LayoutCanvas({ items, outcomes, selectedId, chartKindOf, onSelect, onMove, onShift }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.map((x) => x.item.i);
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) onMove(String(e.active.id), String(e.over.id));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ol className="grid grid-cols-12 gap-3" aria-label="Rapor düzeni">
          {items.map(({ block, item }, index) => (
            <CanvasCard
              key={item.i}
              block={block}
              item={item}
              outcome={outcomes.get(block.id)}
              chartKind={chartKindOf(block.id)}
              selected={selectedId === block.id}
              first={index === 0}
              last={index === items.length - 1}
              onSelect={() => onSelect(block.id)}
              onShift={(d) => onShift(block.id, d)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

interface CardProps {
  block: DefinitionBlock;
  item: LayoutItem;
  outcome: BlockOutcome | undefined;
  chartKind: string;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onShift: (delta: -1 | 1) => void;
}

function CanvasCard({ block, item, outcome, chartKind, selected, first, last, onSelect, onShift }: CardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.i });
  const label = KIND_LABEL[block.tur] ?? block.tur;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("min-w-0", GRID_SPAN_CLASS[item.w] ?? GRID_SPAN_CLASS[12], isDragging && "z-10 opacity-80")}
      data-block-id={block.id}
    >
      {item.sayfaKesmesi ? (
        <p className="mb-1 flex items-center gap-1 border-t border-dashed pt-1 text-xs text-muted-foreground">
          <Scissors className="h-3 w-3" aria-hidden="true" /> Yeni sayfa (PDF)
        </p>
      ) : null}
      <div
        className={cn(
          "flex h-full flex-col rounded-lg border bg-card transition-shadow",
          selected ? "border-primary ring-2 ring-primary/30" : "hover:border-foreground/30",
        )}
      >
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`${label} bölümünü sürükleyerek taşı`}
            className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button type="button" onClick={onSelect} aria-pressed={selected} className="min-w-0 flex-1 truncate text-left text-sm">
            <span className="font-medium">{block.baslik || label}</span>
            {block.baslik ? <span className="ml-1.5 text-xs text-muted-foreground">{label}</span> : null}
          </button>
          <button type="button" aria-label="Yukarı taşı" disabled={first} onClick={() => onShift(-1)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Aşağı taşı" disabled={last} onClick={() => onShift(1)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-w-0 flex-1 p-3">
          {outcome ? <BlockBody block={outcome} chartKind={chartKind} /> : <p className="text-sm text-muted-foreground">Önizleme hazırlanıyor…</p>}
        </div>
      </div>
    </li>
  );
}
