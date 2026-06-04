import { useRef, type WheelEvent } from "react";
import { X, Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useTabsStore, type TabItem } from "@/store/tabs";
import { resolveTabMeta } from "./tab-meta";

/** Açık sekme şeridi — seç / kapat / sürükle-sırala / yeni sekme. */
export function TabStrip() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const openTab = useTabsStore((s) => s.openTab);
  const reorder = useTabsStore((s) => s.reorder);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const ids = tabs.map((t) => t.id);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) reorder(active.id as string, over.id as string);
  };

  // Dikey fare tekerleğini yatay kaydırmaya çevir (taşma varsa) — gizli
  // scrollbar'a rağmen sekmeler arasında gezinmeyi sağlar.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth || e.deltaY === 0) return;
    el.scrollLeft += e.deltaY;
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-border/60 bg-card/40 px-1.5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollRef}
            onWheel={onWheel}
            className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden py-1"
          >
            {tabs.map((tab) => (
              <TabChip
                key={tab.id}
                tab={tab}
                active={tab.id === activeId}
                onSelect={() => setActive(tab.id)}
                onClose={() => closeTab(tab.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={() => openTab("/", { forceNew: true })}
        title="Yeni sekme"
        aria-label="Yeni sekme"
        className="my-1 flex w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ChipProps {
  tab: TabItem;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function TabChip({ tab, active, onSelect, onClose }: ChipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  const Icon = resolveTabMeta(tab.path).icon;

  return (
    <div
      ref={setNodeRef}
      style={{
        // Yalnız yatay sürükleme: dikey ekseni sıfırla (imleç yukarı/aşağı gitse de çip kaymaz).
        transform: CSS.Translate.toString(transform ? { ...transform, y: 0 } : transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose(); // orta tık → kapat
        }
      }}
      className={cn(
        "group flex h-7 min-w-[100px] max-w-[200px] flex-1 items-center gap-1.5 rounded-md pl-2.5 pr-1.5 text-sm transition-colors touch-none",
        active
          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        {...attributes}
        {...listeners}
        className="flex min-w-0 flex-1 items-center gap-1.5"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{tab.title}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`${tab.title} sekmesini kapat`}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
