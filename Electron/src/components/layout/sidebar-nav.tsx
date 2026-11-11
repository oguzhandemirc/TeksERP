import { useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavGroup } from "./nav-config";
import { CollapsedItem, SortableExpandedItem } from "./sidebar-items";
import { CollapsedSectionItem, SectionNavItem } from "./sidebar-section";

// Menü gövdesi — grup başlıkları + satırlar. Kendiliğinden animasyon yok (giriş kademesi kaldırıldı).

const GROUP_HEAD = "px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted";

export function CollapsedNav({ groups }: { groups: NavGroup[] }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <nav className="flex flex-1 flex-col items-center overflow-y-auto py-3">
      {groups.map((group, idx) => (
        <div key={group.label} className="flex w-full flex-col items-center">
          {idx > 0 && <div className="my-2 h-px w-8 bg-sidebar-border" />}
          {group.collapsible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-expanded={advancedOpen}
                  aria-label={group.label}
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Wrench className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{group.label}</TooltipContent>
            </Tooltip>
          )}
          {(!group.collapsible || advancedOpen) && (
            <ul className="flex w-full flex-col items-center gap-1">
              {group.items.map((item) =>
                item.children ? <CollapsedSectionItem key={item.to} item={item} /> : <CollapsedItem key={item.to} item={item} />,
              )}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

export function ExpandedNav({
  groups,
  onReorder,
}: {
  groups: NavGroup[];
  onReorder: (groupLabel: string, order: string[]) => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3">
      {groups.map((group) => (
        <ExpandedGroup key={group.label} group={group} onReorder={onReorder} />
      ))}
    </nav>
  );
}

function ExpandedGroup({
  group,
  onReorder,
}: {
  group: NavGroup;
  onReorder: (groupLabel: string, order: string[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const ids = group.items.map((i) => i.to);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = ids.indexOf(active.id as string);
    const newI = ids.indexOf(over.id as string);
    if (oldI < 0 || newI < 0) return;
    onReorder(group.label, arrayMove(ids, oldI, newI));
  };

  // K19 Gelişmiş grubu: başlık düğmedir, grup varsayılan KAPALI açılır.
  const [open, setOpen] = useState(!group.collapsible);
  return (
    <div className="mb-4">
      {group.collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`mb-1.5 flex w-full items-center gap-1.5 rounded hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${GROUP_HEAD}`}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {group.label}
        </button>
      ) : (
        <p className={`mb-1.5 ${GROUP_HEAD}`}>{group.label}</p>
      )}
      {open && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <SortableExpandedItem key={item.to} item={item}>
                  {item.children ? <SectionNavItem item={item} /> : undefined}
                </SortableExpandedItem>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
