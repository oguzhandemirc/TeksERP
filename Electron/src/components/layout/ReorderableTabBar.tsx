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
import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAGE_TABS_BAR_CLASS, pageTabClass } from "./PageTabs";

export interface ReorderableTab {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Verilirse grup değişen yere ince dikey ayraç çizilir; sürükleme grup içinde kalır. */
  group?: string;
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
    // Gruplar arası taşıma yok: ayraç sabit kalır, grup sırası çağıranın sözleşmesi.
    if (tabs[oldI]?.group !== tabs[newI]?.group) return;
    onReorder(arrayMove(keys, oldI, newI));
  };

  return (
    // Görünüm PageTabs bandıyla aynı (sayfa içi alt sekme); klavye: ok/Home/End sekmeler arasında gezinir.
    <div data-page-tabs="" role="tablist" aria-label="Sekmeler" onKeyDown={onTabKeyDown} className={PAGE_TABS_BAR_CLASS}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabs.map((t) => t.key)} strategy={horizontalListSortingStrategy}>
          {tabs.map((t, i) => (
            <Fragment key={t.key}>
              {i > 0 && t.group !== tabs[i - 1]?.group ? <GroupDivider /> : null}
              <SortableTab tab={t} active={activeKey === t.key} onSelect={() => onSelect(t.key)} />
            </Fragment>
          ))}
        </SortableContext>
      </DndContext>

      {pinnedTab && (
        <>
          {/* Ayrım çizgisi — Arşiv nadir kullanılır, ana sekmelerden ayrık dursun. */}
          <GroupDivider />
          <button
            type="button"
            onClick={() => onSelect(pinnedTab.key)}
            role="tab"
            aria-selected={activeKey === pinnedTab.key}
            tabIndex={activeKey === pinnedTab.key ? 0 : -1}
            className={pageTabClass(activeKey === pinnedTab.key)}
          >
            <pinnedTab.Icon className="h-3.5 w-3.5" />
            {pinnedTab.label}
          </button>
        </>
      )}
      {trailing && <div className="ml-auto flex shrink-0 items-center self-center py-1">{trailing}</div>}
    </div>
  );
}

/** Ok tuşları sekme düğmeleri arasında odağı taşır ve seçer (Radix Tabs ile aynı otomatik seçim). */
function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}

/** 1px dikey ayraç — başlıksız; shrink-0 ile şeritle birlikte kayar, taşmaz. */
function GroupDivider() {
  return <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 self-center bg-border" />;
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
      className={cn(pageTabClass(active), "cursor-pointer touch-none active:cursor-grabbing")}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      aria-roledescription="sıralanabilir sekme"
      tabIndex={active ? 0 : -1}
    >
      <Icon className="h-3.5 w-3.5" />
      {tab.label}
    </button>
  );
}
