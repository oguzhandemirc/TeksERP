import { useMemo } from "react";
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
import { GripVertical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useDashboardLayout } from "./useDashboardLayout";
import {
  findItemGroup,
  getGroup,
  getItemLabel,
  type GroupKey,
} from "./widgetRegistry";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_HANDLE_PREFIX = "group::";

export function DashboardSettingsDialog({ open, onOpenChange }: Props) {
  const {
    isVisible,
    setVisible,
    groupOrder,
    setGroupOrder,
    itemOrder,
    setItemOrder,
    reset,
    customized,
  } = useDashboardLayout();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const groupSortableIds = useMemo(
    () => groupOrder.map((g) => `${GROUP_HANDLE_PREFIX}${g}`),
    [groupOrder],
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Grup-grup taşıma
    if (activeId.startsWith(GROUP_HANDLE_PREFIX) && overId.startsWith(GROUP_HANDLE_PREFIX)) {
      const activeKey = activeId.slice(GROUP_HANDLE_PREFIX.length) as GroupKey;
      const overKey = overId.slice(GROUP_HANDLE_PREFIX.length) as GroupKey;
      const oldIdx = groupOrder.indexOf(activeKey);
      const newIdx = groupOrder.indexOf(overKey);
      if (oldIdx === -1 || newIdx === -1) return;
      setGroupOrder(arrayMove(groupOrder, oldIdx, newIdx));
      return;
    }

    // Item taşıma — sadece aynı grup içinde
    const activeGroup = findItemGroup(activeId);
    const overGroup = findItemGroup(overId);
    if (!activeGroup || activeGroup !== overGroup) return;

    const order = itemOrder(activeGroup);
    const oldIdx = order.indexOf(activeId);
    const newIdx = order.indexOf(overId);
    if (oldIdx === -1 || newIdx === -1) return;
    setItemOrder(activeGroup, arrayMove(order, oldIdx, newIdx));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dashboard Düzenle</DialogTitle>
          <DialogDescription>
            Grup ve widget sıralarını sürükleyerek değiştir, görünürlüğü işaretle.
            Tercih bu cihazda saklanır.
          </DialogDescription>
        </DialogHeader>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={groupSortableIds} strategy={verticalListSortingStrategy}>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {groupOrder.map((gKey) => {
                const group = getGroup(gKey);
                const order = itemOrder(gKey);
                return (
                  <SortableGroup
                    key={gKey}
                    groupKey={gKey}
                    label={group.label}
                    itemKeys={order}
                    isVisible={isVisible}
                    setVisible={setVisible}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={!customized}
            className="gap-2"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Varsayılana dön
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Tamam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SortableGroupProps {
  groupKey: GroupKey;
  label: string;
  itemKeys: string[];
  isVisible: (key: string) => boolean;
  setVisible: (key: string, visible: boolean) => void;
}

function SortableGroup({ groupKey, label, itemKeys, isVisible, setVisible }: SortableGroupProps) {
  const sortable = useSortable({ id: `${GROUP_HANDLE_PREFIX}${groupKey}` });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "rounded-md border bg-card/30 p-2",
        sortable.isDragging && "ring-2 ring-ring",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label="Grup sırasını değiştir"
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
      </div>

      <SortableContext items={itemKeys} strategy={verticalListSortingStrategy}>
        <ul className="space-y-0.5">
          {itemKeys.map((k) => (
            <SortableItem
              key={k}
              itemKey={k}
              checked={isVisible(k)}
              onChange={(c) => setVisible(k, c)}
            />
          ))}
        </ul>
      </SortableContext>
    </div>
  );
}

interface SortableItemProps {
  itemKey: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SortableItem({ itemKey, checked, onChange }: SortableItemProps) {
  const sortable = useSortable({ id: itemKey });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const label = getItemLabel(itemKey) ?? itemKey;

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40",
        sortable.isDragging && "bg-accent/60",
      )}
    >
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label="Sıralamayı değiştir"
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        id={`vis-${itemKey}`}
      />
      <label htmlFor={`vis-${itemKey}`} className="flex-1 cursor-pointer text-sm">
        {label}
      </label>
    </li>
  );
}
