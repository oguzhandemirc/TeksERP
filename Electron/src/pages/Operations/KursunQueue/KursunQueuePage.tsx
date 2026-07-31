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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatNumber } from "@/lib/format";
import { kursunQueueService } from "./service";
import type { KursunQueueItem } from "./types";
import { KursunQueueRow } from "./KursunQueueRow";
import { reorderQueue } from "./queue-reorder";

const QUERY_KEY = "kursun-queue";

/**
 * Kurşun Sırası — kurşun tabletinin okuyacağı DÜZ kuyruk. Gruplama YOKTUR:
 * fabrikada PROCESS_QC türünde tek istasyon var, bu ekran o tek istasyonun
 * bekleyenlerini sıralar.
 *
 * ⚠️ Bu ekran kurşun bypass bayrağı AÇIKKEN hiç açılmaz (`KursunQueueRouteGate`):
 * sıralamanın tek tüketicisi kurşun tabletiydi, bypass rejiminde kurşunda tablet
 * yok. İzleme + acil işaretleme Kurşun Dağıtım ekranında (aynı sıralamayla) yapılır.
 * Satırdaki "Bypass" rozeti yalnız KARIŞIK REJİM içindir (bayrak yeni açıldı ve
 * bir kısım iş hâlâ tablet akışında bekliyor).
 */
export function KursunQueuePage() {
  const qc = useQueryClient();
  // Sıralama backend'de `quality:write` ister; dağıtımcı (workorder:distribute)
  // kuyruğu yalnız İZLER — yetkisiz sürükleme 403 üretirdi.
  const { hasPermission } = useRoleAccess();
  const canReorder = hasPermission("quality:write");

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

  const totalQty = items.reduce((sum, i) => sum + i.totalCurrentQty, 0);
  const bypassCount = items.filter((i) => i.bypassAssigned).length;

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

  /** Sıra + priority hesabı `reorderQueue`'da (saf fonksiyon — birim testli). */
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const result = reorderQueue(items, String(active.id), String(over.id));
    if (!result) return;

    setItems(result.next);
    if (result.payload.length > 0) reorderMut.mutate(result.payload);
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

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-xs">
        <span>
          <span className="text-foreground font-medium">{items.length}</span> bekleyen
          iş emri · {formatNumber(totalQty, 0)} m
        </span>
        {bypassCount > 0 && (
          <span>{bypassCount} iş kurşun dağıtımına verilmiş (tablette okutulmaz)</span>
        )}
        {!canReorder && <span>Salt izleme — sıralama için kalite yetkisi gerekir.</span>}
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
                    canReorder={canReorder}
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
