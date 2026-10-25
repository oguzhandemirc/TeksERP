// Sürükle-sırala: tablette muayene düğmelerinin sırası. Toplu sıra ucu yok → değişen satırlar tek tek
// PATCH edilir (SIRALI; yarıda kalırsa kalan satırlar eski sırada kalır, liste tazelenip gerçeği gösterir).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { loadAllForPicker } from "@/lib/picker-loader";
import { defectTypeService } from "./service";
import { orderDefectTypes, sortOrderChanges } from "./defectSort";
import type { DefectType } from "./types";

function Row({ row, index }: { row: DefectType; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <li ref={setNodeRef} data-testid="sort-row" style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-md border bg-background p-2 ${isDragging ? "shadow-lg ring-2 ring-primary" : ""}`}>
      <button type="button" aria-label={`${row.name} sürükle`} className="cursor-grab touch-none text-muted-foreground" {...attributes} {...listeners}><GripVertical className="h-5 w-5" /></button>
      <span className="w-8 text-right tabular-nums text-muted-foreground">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
      {row.fixedPoints != null && <Badge variant="outline">{row.fixedPoints} puan</Badge>}
    </li>
  );
}

export function DefectTypeSortDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["defect-types", "sort"], queryFn: () => loadAllForPicker(defectTypeService), enabled: open });
  const [rows, setRows] = useState<DefectType[]>([]);
  useEffect(() => { if (q.data) setRows(orderDefectTypes(q.data.data)); }, [q.data]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setRows((prev) => arrayMove(prev, prev.findIndex((r) => r.id === active.id), prev.findIndex((r) => r.id === over.id)));
  };
  const changes = sortOrderChanges(rows);
  const save = useMutation({
    mutationFn: async () => {
      for (const c of changes) await defectTypeService.update(c.id, { sortOrder: c.sortOrder });
    },
    onSuccess: () => { toast.success("Sıra kaydedildi."); onOpenChange(false); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["defect-types"] }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Hata tiplerini sırala</DialogTitle>
          <DialogDescription>Tablette muayene düğmeleri bu sırayla dizilir. Satırı tutup sürükleyin (klavye: boşluk + ok tuşları).</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.isLoading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p>
            : rows.length === 0 ? <p className="text-sm text-muted-foreground">Aktif hata tipi yok.</p>
            : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                  <ol className="space-y-1">{rows.map((r, i) => <Row key={r.id} row={r} index={i} />)}</ol>
                </SortableContext>
              </DndContext>
            )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={changes.length === 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Kaydediliyor…" : "Sırayı kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
