import { Trash2, GripVertical } from "lucide-react";
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
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type {
  CatalogField,
  TemplateField,
} from "@/services/labelTemplateService";

interface Props {
  fields: TemplateField[];
  catalogByKey: Map<string, CatalogField>;
  onChange: (next: TemplateField[]) => void;
}

/**
 * Şablon alan listesi — sürükle-bırak ile sıralanır. Sıra ARTIK anlamlı: native
 * renderer'lar (PPLA/PPLB/ZPL) metin satırlarını `order`'a göre dizer; HTML
 * curated zone düzenini korur (barkod/QR + başlık sabit, kullanıcı kararı).
 * order, kaydederken dizilim sırasından yeniden numaralanır (edit page).
 */
export function FieldsPanel({ fields, catalogByKey, onChange }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const updateField = (key: string, patch: Partial<TemplateField>) => {
    onChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  };

  const removeField = (key: string) => {
    onChange(fields.filter((f) => f.key !== key));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.key === active.id);
    const newIndex = fields.findIndex((f) => f.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(fields, oldIndex, newIndex));
  };

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Şablon Alanları ({fields.length})
        </div>
      </div>
      {fields.length === 0 ? (
        <div className="rounded border border-dashed p-6 text-center text-xs italic text-muted-foreground">
          Soldaki listeden alan ekleyerek başla.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {fields.map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  meta={catalogByKey.get(f.key)}
                  onUpdate={updateField}
                  onRemove={removeField}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function FieldRow({
  field,
  meta,
  onUpdate,
  onRemove,
}: {
  field: TemplateField;
  meta: CatalogField | undefined;
  onUpdate: (key: string, patch: Partial<TemplateField>) => void;
  onRemove: (key: string) => void;
}) {
  const required = meta?.required;
  const isScan = meta?.type === "barcode" || meta?.type === "qr";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.key,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-nowrap items-center gap-2 rounded-md border bg-background px-2 py-2 text-xs"
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        title="Sürükle-sırala"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Badge variant="outline" className="font-mono text-[9px]">
        {field.key}
      </Badge>
      <Input
        value={field.label}
        onChange={(e) => onUpdate(field.key, { label: e.target.value })}
        className="h-7 min-w-0 flex-1 text-xs"
        placeholder={meta?.defaultLabel}
      />
      <label className="flex items-center gap-1 text-[10px]">
        <input
          type="checkbox"
          checked={field.isVisible}
          disabled={required}
          onChange={(e) => onUpdate(field.key, { isVisible: e.target.checked })}
        />
        Görünür
        {required && (
          <span className="text-warning" title="Zorunlu alan">
            *
          </span>
        )}
      </label>
      {isScan ? (
        // Barkod/QR = grafik, metin değil → font boyutu/kalın işe yaramaz. QR boyutu
        // "Yerleşim → QR boyutu"ndan; barkod boyutu sabit (alt bant).
        <span
          className="whitespace-nowrap text-[9px] italic text-muted-foreground"
          title="Barkod/QR grafiktir — font boyutu/kalın etkisizdir. QR boyutu: Yerleşim → QR boyutu. Barkod boyutu sabit."
        >
          grafik · boyut Yerleşim'den
        </span>
      ) : (
        <>
          <label className="flex items-center gap-1 text-[10px]">
            <input
              type="checkbox"
              checked={field.isBold ?? false}
              onChange={(e) => onUpdate(field.key, { isBold: e.target.checked })}
            />
            Kalın
          </label>
          <select
            value={field.fontSize ?? "md"}
            onChange={(e) =>
              onUpdate(field.key, {
                fontSize: e.target.value as TemplateField["fontSize"],
              })
            }
            className="h-7 rounded border bg-background px-1 text-[10px]"
            title="Yazı boyutu"
          >
            <option value="sm">sm</option>
            <option value="md">md</option>
            <option value="lg">lg</option>
            <option value="xl">xl</option>
          </select>
        </>
      )}
      {!required && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => onRemove(field.key)}
          className="h-6 w-6 shrink-0 text-destructive"
          title="Alanı kaldır"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </li>
  );
}
