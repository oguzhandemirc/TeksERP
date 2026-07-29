import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { kursunQueueService } from "./service";
import type { KursunQueueItem } from "./types";
import { KursunQueueRow } from "./KursunQueueRow";

const QUERY_KEY = "kursun-queue";

export function KursunQueuePage() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: () => kursunQueueService.list(),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const [items, setItems] = useState<KursunQueueItem[]>([]);
  useEffect(() => {
    setItems(query.data?.data ?? []);
  }, [query.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMut = useMutation({
    mutationFn: kursunQueueService.reorder,
    onSuccess: () => {
      toast.success("Sıralama güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const urgentMut = useMutation({
    mutationFn: ({ id, isUrgent }: { id: string; isUrgent: boolean }) =>
      kursunQueueService.setUrgent(id, isUrgent),
    onSuccess: () => {
      toast.success("Acillik durumu güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.workOrderStepId === active.id);
    const newIdx = items.findIndex((i) => i.workOrderStepId === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);

    // Acil işaretli WO'lar otomatik üste pinlendiği için onları reorder
    // payload'ından dışta tutuyoruz. priority asc → küçük = üstte.
    const reorderable = next.filter((i) => !i.isUrgent);
    const payload = reorderable.map((i, idx) => ({
      id: i.workOrderStepId,
      priority: idx * 10,
    }));
    if (payload.length > 0) reorderMut.mutate(payload);
  };

  const busy = reorderMut.isPending || urgentMut.isPending;

  return (
    <PageShell>
      <PageHeader
        title="Kurşun Sırası"
        actions={
          <RefreshButton queryKey={QUERY_KEY} successMessage="Kuyruk yenilendi" />
        }
      />

      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">{items.length}</span>{" "}
          bekleyen iş emri
        </div>
      </div>

      <PageBody className="p-4">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center rounded-md border border-dashed text-sm">
            Kurşun istasyonunda bekleyen iş emri yok.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((i) => i.workOrderStepId)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {items.map((item, idx) => (
                  <KursunQueueRow
                    key={item.workOrderStepId}
                    item={item}
                    index={idx}
                    busy={busy}
                    onToggleUrgent={() =>
                      urgentMut.mutate({
                        id: item.workOrderStepId,
                        isUrgent: !item.isUrgent,
                      })
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </PageBody>
    </PageShell>
  );
}
