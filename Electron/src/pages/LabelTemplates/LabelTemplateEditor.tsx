import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save, Trash2, GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  labelTemplateService,
  type CatalogField,
  type TemplateField,
} from "@/services/labelTemplateService";

interface Props {
  templateId: string | null;
  onClose: () => void;
}

export function LabelTemplateEditor({ templateId, onClose }: Props) {
  const open = Boolean(templateId);
  const qc = useQueryClient();

  const templateQ = useQuery({
    queryKey: ["label-template", templateId],
    queryFn: () => labelTemplateService.getById(templateId!),
    enabled: open,
  });
  const template = templateQ.data?.data;

  const catalogQ = useQuery({
    queryKey: ["label-template-catalog", template?.kind],
    queryFn: () => labelTemplateService.getCatalog(template!.kind),
    enabled: open && Boolean(template?.kind),
  });

  const [name, setName] = useState("");
  const [fields, setFields] = useState<TemplateField[]>([]);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setFields(
        [...template.fields]
          .sort((a, b) => a.order - b.order)
          .map((f, i) => ({ ...f, order: i + 1 })),
      );
    }
  }, [template]);

  const catalog = catalogQ.data?.data?.fields ?? [];
  const usedKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);
  const availableCatalog = catalog.filter((c) => !usedKeys.has(c.key));
  const catalogByKey = useMemo(() => {
    const m = new Map<string, CatalogField>();
    for (const c of catalog) m.set(c.key, c);
    return m;
  }, [catalog]);

  const saveMut = useMutation({
    mutationFn: () =>
      labelTemplateService.update(templateId!, {
        name: name.trim(),
        fields: fields.map((f, i) => ({ ...f, order: i + 1 })),
      }),
    onSuccess: () => {
      toast.success("Şablon kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["label-templates"] });
      void qc.invalidateQueries({ queryKey: ["label-template", templateId] });
      onClose();
    },
  });

  const addField = (cat: CatalogField) => {
    setFields((prev) => [
      ...prev,
      {
        key: cat.key,
        label: cat.defaultLabel,
        order: prev.length + 1,
        isVisible: true,
      },
    ]);
  };

  const updateField = (key: string, patch: Partial<TemplateField>) => {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  };

  const removeField = (key: string) => {
    setFields((prev) => prev.filter((f) => f.key !== key));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFields((prev) => {
      const oldIdx = prev.findIndex((f) => f.key === active.id);
      const newIdx = prev.findIndex((f) => f.key === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Şablonu Düzenle</SheetTitle>
          <SheetDescription>
            Alanları sürükle-bırak ile sırala. Görünürlük, başlık ve görsel detay alan bazında.
          </SheetDescription>
        </SheetHeader>

        {templateQ.isLoading || catalogQ.isLoading ? (
          <Skeleton className="mt-4 h-96 w-full" />
        ) : template ? (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-medium">Şablon adı</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr]">
              <CatalogPanel
                available={availableCatalog}
                onAdd={addField}
              />
              <FieldsPanel
                fields={fields}
                catalogByKey={catalogByKey}
                onUpdate={updateField}
                onRemove={removeField}
                sensors={sensors}
                onDragEnd={handleDragEnd}
              />
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button type="button" variant="outline" onClick={onClose}>
                İptal
              </Button>
              <Button
                type="button"
                disabled={saveMut.isPending || !name.trim()}
                onClick={() => saveMut.mutate()}
                className="gap-1"
              >
                <Save className="h-4 w-4" />
                {saveMut.isPending ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CatalogPanel({
  available,
  onAdd,
}: {
  available: CatalogField[];
  onAdd: (f: CatalogField) => void;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Catalog ({available.length})
      </div>
      {available.length === 0 ? (
        <div className="text-xs italic text-muted-foreground">Tüm alanlar eklenmiş.</div>
      ) : (
        <ul className="space-y-1">
          {available.map((f) => (
            <li key={f.key}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-full justify-start gap-1 text-xs"
                onClick={() => onAdd(f)}
              >
                <Plus className="h-3 w-3" />
                <span>{f.defaultLabel}</span>
                <Badge variant="muted" className="ml-auto text-[9px]">
                  {f.type}
                </Badge>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldsPanel({
  fields,
  catalogByKey,
  onUpdate,
  onRemove,
  sensors,
  onDragEnd,
}: {
  fields: TemplateField[];
  catalogByKey: Map<string, CatalogField>;
  onUpdate: (key: string, patch: Partial<TemplateField>) => void;
  onRemove: (key: string) => void;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (e: DragEndEvent) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Şablonda ({fields.length})
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {fields.map((f) => (
              <FieldRow
                key={f.key}
                field={f}
                meta={catalogByKey.get(f.key)}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const required = meta?.required;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground hover:text-foreground"
        aria-label="Sürükle"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Badge variant="outline" className="font-mono text-[9px]">
        {field.key}
      </Badge>
      <Input
        value={field.label}
        onChange={(e) => onUpdate(field.key, { label: e.target.value })}
        className="h-7 w-40 text-xs"
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
          <span className="text-amber-600" title="Zorunlu alan">
            *
          </span>
        )}
      </label>
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
      >
        <option value="sm">sm</option>
        <option value="md">md</option>
        <option value="lg">lg</option>
        <option value="xl">xl</option>
      </select>
      {!required && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => onRemove(field.key)}
          className="ml-auto h-6 w-6 text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </li>
  );
}
