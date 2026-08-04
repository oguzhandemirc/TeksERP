import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { SECTION_LABELS, type SectionEntry, type SectionKey } from "./types";

/**
 * Bölüm sıralayıcı — kartın gövdesini oluşturan bloklar sürüklenip sıralanır,
 * anahtarla açılıp kapatılır.
 *
 * TEK ANAHTAR KURALI: bir bölümün açık/kapalısı burada TEK yerden yönetilir.
 * Eski görünürlük bayrağı olan bölümlerde (Siparişler, Talimatlar…) anahtar o
 * bayrağı yazar (bkz. SECTION_LEGACY_FLAG) — böylece "Refakat Kartı Ayarları"
 * ekranı ile stüdyo aynı gerçeği söyler, kullanıcı iki yerden kapatıp
 * "neden hâlâ basılıyor" sormaz.
 */
export function SectionList({
  sections,
  isEnabled,
  onReorder,
  onToggle,
  disabled,
}: {
  sections: SectionEntry[];
  /** Bölümün EFEKTİF açıklığı (eski bayrak + entry.enabled birlikte çözülür). */
  isEnabled: (key: SectionKey) => boolean;
  onReorder: (next: SectionEntry[]) => void;
  onToggle: (key: SectionKey, next: boolean) => void;
  disabled?: boolean;
}) {
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = sections.findIndex((s) => s.key === active.id);
    const to = sections.findIndex((s) => s.key === over.id);
    if (from < 0 || to < 0) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    onReorder(next);
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sections.map((s) => s.key)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5">
          {sections.map((s) => (
            <SectionRow
              key={s.key}
              sectionKey={s.key}
              enabled={isEnabled(s.key)}
              disabled={disabled}
              onToggle={(v) => onToggle(s.key, v)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SectionRow({
  sectionKey,
  enabled,
  disabled,
  onToggle,
}: {
  sectionKey: SectionKey;
  enabled: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sectionKey,
  });
  const meta = SECTION_LABELS[sectionKey];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md border bg-background p-2",
        isDragging && "opacity-60 shadow-md",
        !enabled && "bg-muted/40",
      )}
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground active:cursor-grabbing disabled:cursor-not-allowed"
        aria-label={`${meta.label} bölümünü taşı`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", !enabled && "text-muted-foreground")}>
          {meta.label}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{meta.desc}</div>
      </div>
      <Checkbox
        checked={enabled}
        disabled={disabled}
        aria-label={`${meta.label} bölümünü göster`}
        onCheckedChange={(v) => onToggle(v === true)}
      />
    </li>
  );
}
