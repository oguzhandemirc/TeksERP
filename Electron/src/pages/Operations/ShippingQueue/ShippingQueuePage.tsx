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
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { shippingQueueService } from "./service";
import type { ShippingQueueItem } from "./types";
import { QueueRow } from "./QueueRow";
import { OrphanRollsSection } from "./OrphanRollsSection";

const QUERY_KEY = "shipping-queue";

type Filter = "ACTIVE" | "WAITING" | "TAKEN" | "DONE" | "ALL";

export function ShippingQueuePage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("ACTIVE");

  const query = useQuery({
    queryKey: [QUERY_KEY, filter],
    queryFn: () => {
      if (filter === "ACTIVE") return shippingQueueService.list();
      return shippingQueueService.list(filter);
    },
    refetchOnMount: "always",
    staleTime: 0,
  });

  const [items, setItems] = useState<ShippingQueueItem[]>([]);
  useEffect(() => {
    setItems(query.data?.data ?? []);
  }, [query.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMut = useMutation({
    mutationFn: shippingQueueService.reorder,
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
      shippingQueueService.setUrgent(id, isUrgent),
    onSuccess: () => {
      toast.success("Acillik durumu güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => shippingQueueService.cancel(id),
    onSuccess: () => {
      toast.success("Sipariş kuyruktan çıkarıldı.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);

    const reorderable = next.filter(
      (i) => i.status === "WAITING" && !i.isUrgent,
    );
    const payload = reorderable.map((i, idx) => ({
      id: i.id,
      priority: idx * 10,
    }));
    if (payload.length > 0) reorderMut.mutate(payload);
  };

  const busy =
    reorderMut.isPending || urgentMut.isPending || removeMut.isPending;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevkiyat Kuyruğu"
        description="Açık siparişleri sevkiyat akışına ekle ve önceliklerini yönet. Saha operatörü kuyruktan sırayı alır, kumaşları depodan kendisi tarayarak çuvallara koyar."
        actions={
          <RefreshButton
            queryKey={QUERY_KEY}
            successMessage="Kuyruk yenilendi"
          />
        }
      />

      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="ACTIVE">Aktif</TabsTrigger>
            <TabsTrigger value="WAITING">Bekleyen</TabsTrigger>
            <TabsTrigger value="TAKEN">Alınan</TabsTrigger>
            <TabsTrigger value="DONE">Tamamlanan</TabsTrigger>
            <TabsTrigger value="ALL">Tümü</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">{items.length}</span>{" "}
          kayıt
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        <OrphanRollsSection />

        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center rounded-md border border-dashed text-sm">
            Bu filtrede kayıt yok. Sipariş ekleyebilirsin: Siparişler sayfasından
            "Sevkiyat Kuyruğuna Al".
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {items.map((item, idx) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    index={idx}
                    busy={busy}
                    onToggleUrgent={() =>
                      urgentMut.mutate({
                        id: item.id,
                        isUrgent: !item.isUrgent,
                      })
                    }
                    onRemove={() => removeMut.mutate(item.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
