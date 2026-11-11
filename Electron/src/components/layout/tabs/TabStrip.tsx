import { useEffect, useRef, type WheelEvent } from "react";
import { X, Plus, CopyX } from "lucide-react";
import { requestCloseTabs } from "./dirty-close-guard";
import { useIsTabDirty } from "./dirty-tabs";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useTabsStore, type TabItem } from "@/store/tabs";
import { resolveTabMeta } from "./tab-meta";
import { TabContextMenu } from "./TabContextMenu";
import { CLOSE_ALL_SHORTCUT } from "./tab-close";

/** Açık sekme şeridi — seç / kapat / sağ tık toplu kapat / sürükle-sırala / yeni sekme / tümünü kapat. */
export function TabStrip() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const openTab = useTabsStore((s) => s.openTab);
  const reorder = useTabsStore((s) => s.reorder);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const ids = tabs.map((t) => t.id);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) reorder(active.id as string, over.id as string);
  };

  // Dikey fare tekerleğini yatay kaydırmaya çevir (taşma varsa) — gizli
  // scrollbar'a rağmen sekmeler arasında gezinmeyi sağlar.
  // Taşan şeritte aktif sekme görünür alana kayar (kısayolla/menüden geçişte gözden kaybolmasın).
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-tab-id="${activeId ?? ""}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth || e.deltaY === 0) return;
    el.scrollLeft += e.deltaY;
  };

  return (
    // Sekme bandı kromdan bir ton farklı; alt çizgi iç gölgedir ki etkin sekme (içerik zemini) üstünü örtüp içeriğe "bağlansın".
    <div className="flex h-10 shrink-0 select-none items-stretch gap-1 bg-tabstrip px-2 shadow-[inset_0_-1px_0_var(--color-chrome-border)] sm:px-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollRef}
            onWheel={onWheel}
            className="no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden pt-1"
          >
            {tabs.map((tab) => (
              <TabChip
                key={tab.id}
                tab={tab}
                active={tab.id === activeId}
                onSelect={() => setActive(tab.id)}
                onClose={() => requestCloseTabs("self", tab.id)}
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
      <div aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
      <button
        type="button"
        onClick={() => requestCloseTabs("all")}
        disabled={tabs.length === 0}
        title={`Tümünü kapat (${CLOSE_ALL_SHORTCUT})`}
        aria-label="Tüm sekmeleri kapat"
        className="my-1 flex w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <CopyX className="h-4 w-4" />
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
  const dirty = useIsTabDirty(tab.id);

  // Tetikleyici asChild: Radix Slot sortable ref'ini ve fare olaylarını birleştirir.
  return (
    <TabContextMenu tabId={tab.id}>
      <div
        ref={setNodeRef}
        data-tab-id={tab.id}
        data-active={active ? "true" : undefined}
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
          "group relative flex min-w-[7.5rem] max-w-[13.5rem] shrink items-center gap-2 pl-2.5 pr-1.5 text-[13px] transition-colors touch-none",
          active
            ? "h-9 rounded-t-lg border border-b-0 border-chrome-border bg-background font-semibold text-foreground before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-b-full before:bg-primary"
            : "mb-1 h-8 rounded-lg text-muted-foreground hover:bg-background/60 hover:text-foreground",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          {...attributes}
          {...listeners}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
          <span className="truncate">{tab.title}</span>
          {dirty && <span className="sr-only"> (kaydedilmemiş değişiklik)</span>}
        </button>
        <CloseButton title={tab.title} dirty={dirty} active={active} onClose={onClose} />
      </div>
    </TabContextMenu>
  );
}

/**
 * Kapat düğmesi; kirli sekmede (VS Code kalıbı) yerinde dolu nokta durur, üstüne gelince X'e döner.
 * Nokta her zaman görünür — çip aktif olmasa da kaydedilmemiş iş gözden kaçmasın.
 */
function CloseButton(props: { title: string; dirty: boolean; active: boolean; onClose: () => void }) {
  const { title, dirty, active, onClose } = props;
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={
        dirty ? `${title} sekmesini kapat (kaydedilmemiş değişiklik var)` : `${title} sekmesini kapat`
      }
      title={dirty ? "Kaydedilmemiş değişiklik var" : undefined}
      data-dirty={dirty ? "" : undefined}
      className={cn(
        "group/close relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100",
        dirty || active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      {dirty && <span aria-hidden className="h-2 w-2 rounded-full bg-warning group-hover/close:hidden" />}
      <X className={cn("h-3.5 w-3.5", dirty && "hidden group-hover/close:block")} />
    </button>
  );
}
