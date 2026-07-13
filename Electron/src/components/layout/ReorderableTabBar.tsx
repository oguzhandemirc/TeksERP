import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReorderableTab {
  key: string;
  label: string;
  Icon: LucideIcon;
}

// Sürüklemeyi yatay eksende tut: sekme dikey kaymaz → bırakma hedefi (over)
// hep bulunur, sıra geri dönmez. (@dnd-kit/modifiers paketi yok, inline modifier.)
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

interface Props {
  /** Görünüm sırasında sekmeler (çağıran kayıtlı sırayı uygular). */
  tabs: ReorderableTab[];
  /** Son sekmeden hemen sonra (ayrım çizgisiyle) render edilen, sürüklenemez sekme
   *  (örn. Arşiv — nadir kullanılır, ana sekmelerden ayrık dursun diye). */
  pinnedTab?: ReorderableTab;
  activeKey: string;
  onSelect: (key: string) => void;
  /** Sürükle-bırak sonrası yeni key sırası — kalıcı kaydı çağıran yapar. */
  onReorder: (keys: string[]) => void;
  /** Şeridin EN SAĞINA (ml-auto) render edilen içerik — örn. "Top/Metre" özeti. */
  trailing?: ReactNode;
}

/**
 * Sürüklenip sıralanabilen sekme şeridi. 8px eşik → küçük hareket = tıklama
 * (sekme seçer), 8px üstü = sürükleme (sıralar). Sıra kaydı çağırana ait.
 */
export function ReorderableTabBar({ tabs, pinnedTab, activeKey, onSelect, onReorder, trailing }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const keys = tabs.map((t) => t.key);
    const oldI = keys.indexOf(active.id as string);
    const newI = keys.indexOf(over.id as string);
    if (oldI < 0 || newI < 0) return;
    onReorder(arrayMove(keys, oldI, newI));
  };

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 pt-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabs.map((t) => t.key)} strategy={horizontalListSortingStrategy}>
          {tabs.map((t) => (
            <SortableTab key={t.key} tab={t} active={activeKey === t.key} onSelect={() => onSelect(t.key)} />
          ))}
        </SortableContext>
      </DndContext>

      {pinnedTab && (
        <>
          {/* Ayrım çizgisi — Arşiv nadir kullanılır, ana sekmelerden ayrık dursun. */}
          <span className="mx-1 h-5 w-px shrink-0 self-center bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => onSelect(pinnedTab.key)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
              activeKey === pinnedTab.key
                ? "border-b-primary text-foreground"
                : "border-b-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <pinnedTab.Icon className="h-3.5 w-3.5" />
            {pinnedTab.label}
          </button>
        </>
      )}
      {trailing && <div className="ml-auto flex shrink-0 items-center pb-1.5">{trailing}</div>}
    </div>
  );
}

function SortableTab({
  tab,
  active,
  onSelect,
}: {
  tab: ReorderableTab;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.key,
  });
  const { Icon } = tab;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(
        "flex shrink-0 cursor-pointer touch-none items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-medium transition-colors active:cursor-grabbing",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      {...attributes}
      {...listeners}
    >
      <Icon className="h-3.5 w-3.5" />
      {tab.label}
    </button>
  );
}
