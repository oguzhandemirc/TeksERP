import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, type LucideIcon } from "lucide-react";
import { HubCard } from "./HubCard";

export interface SortableHubTile {
  key: string;
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Açık ton class — verilmezse index paletine düşer. */
  tone?: string;
}

interface Props {
  /** Görünür sırada kartlar (çağıran kayıtlı sırayı uygular). */
  tiles: SortableHubTile[];
  /** Sürükle-bırak sonrası yeni key sırası — kalıcı kaydı çağıran yapar. */
  onReorder: (keys: string[]) => void;
}

/**
 * Sürüklenip sıralanabilen hub kart grid'i. Yalnız köşedeki ⠿ tutamacı sürükler;
 * kartın geri kalanına tık sayfayı açar (kazara sıralama olmaz). Sıra kaydı
 * çağırana ait — bkz. [[useHubOrder]]. HubGrid'in grid sınıflarını birebir izler.
 */
export function SortableHubGrid({ tiles, onReorder }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const keys = tiles.map((t) => t.key);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = keys.indexOf(active.id as string);
    const newI = keys.indexOf(over.id as string);
    if (oldI < 0 || newI < 0) return;
    onReorder(arrayMove(keys, oldI, newI));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={keys} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile, i) => (
            <SortableHubItem key={tile.key} tile={tile} index={i} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableHubItem({ tile, index }: { tile: SortableHubTile; index: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: tile.key });

  // Tutamaç: dnd activator — listeners + attributes burada (kart butonunun kardeşi).
  const handle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      aria-label="Sürükleyerek sırala"
      className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      className="h-full"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <HubCard
        to={tile.to}
        title={tile.title}
        description={tile.description}
        icon={tile.icon}
        tone={tile.tone}
        index={index}
        dragHandle={handle}
      />
    </div>
  );
}
