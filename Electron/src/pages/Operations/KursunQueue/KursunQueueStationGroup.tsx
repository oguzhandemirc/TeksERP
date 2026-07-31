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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Factory } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { KursunQueueRow } from "./KursunQueueRow";
import type { KursunQueueItem } from "./types";

export interface KursunQueueStationGroupData {
  /** Grup anahtarı = istasyon ADI (kuyruk satırında istasyon id'si gelmez). */
  stationName: string;
  items: KursunQueueItem[];
}

/**
 * Kuyruğu FİZİKSEL İSTASYONA göre gruplar. Kurşun artık tek istasyon değil
 * (bypass düzeninde iş N fiziksel kurşun istasyonuna dağıtılır); düz liste
 * "hangi istasyon ne kadar dolu" sorusunu görünmez kılıyordu.
 * Satır sırası backend'ten geldiği gibi korunur (acil → öncelik), grup sırası
 * ilk görülen istasyon.
 */
export function groupQueueByStation(
  items: KursunQueueItem[],
): KursunQueueStationGroupData[] {
  const groups = new Map<string, KursunQueueStationGroupData>();
  for (const item of items) {
    const existing = groups.get(item.stationName);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.stationName, { stationName: item.stationName, items: [item] });
    }
  }
  return [...groups.values()];
}

interface Props {
  group: KursunQueueStationGroupData;
  busy: boolean;
  /** Sıralama yetkisi (quality:write). Yoksa kuyruk salt-izleme olur. */
  canReorder: boolean;
  onDragEnd: (stationName: string, event: DragEndEvent) => void;
  onToggleUrgent: (item: KursunQueueItem) => void;
}

/**
 * Tek bir kurşun istasyonunun kuyruğu. DndContext GRUP BAŞINA kurulur —
 * sürükleme böylece istasyon dışına taşamaz (satırı başka istasyona bırakmak
 * fiziksel işi taşımaz, yalnız sıralamayı bozardı).
 */
export function KursunQueueStationGroup({
  group,
  busy,
  canReorder,
  onDragEnd,
  onToggleUrgent,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const totalQty = group.items.reduce((sum, i) => sum + i.totalCurrentQty, 0);
  const totalRolls = group.items.reduce((sum, i) => sum + i.openRollCount, 0);

  return (
    <section className="rounded-md border">
      <div className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <Factory className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="font-medium">{group.stationName}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {group.items.length} bekleyen iş emri · {totalRolls} top ·{" "}
          {formatNumber(totalQty, 0)} m
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => onDragEnd(group.stationName, event)}
      >
        <SortableContext
          items={group.items.map((i) => i.workOrderStepId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2 p-2">
            {group.items.map((item, idx) => (
              <KursunQueueRow
                key={item.workOrderStepId}
                item={item}
                index={idx}
                busy={busy}
                canReorder={canReorder}
                onToggleUrgent={() => onToggleUrgent(item)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}
