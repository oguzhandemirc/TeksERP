import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatNumber } from "@/lib/format";
import { kursunQueueService } from "./service";
import type { KursunQueueItem } from "./types";
import {
  KursunQueueStationGroup,
  groupQueueByStation,
} from "./KursunQueueStationGroup";
import { reorderWithinStation } from "./queue-reorder";

const QUERY_KEY = "kursun-queue";

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

  const groups = useMemo(() => groupQueueByStation(items), [items]);
  const totalQty = items.reduce((sum, i) => sum + i.totalCurrentQty, 0);

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

  /** Sıralama İSTASYON GRUBU içinde yapılır — hesap `reorderWithinStation`'da. */
  const handleDragEnd = (stationName: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const result = reorderWithinStation(
      items,
      stationName,
      String(active.id),
      String(over.id),
    );
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
          iş emri
        </span>
        <span>
          <span className="text-foreground font-medium">{groups.length}</span> istasyon ·{" "}
          {formatNumber(totalQty, 0)} m
        </span>
        {!canReorder && <span>Salt izleme — sıralama için kalite yetkisi gerekir.</span>}
      </div>

      <PageBody className="p-4">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center rounded-md border border-dashed text-sm">
            Kurşun istasyonunda bekleyen iş emri yok.
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <KursunQueueStationGroup
                key={group.stationName}
                group={group}
                busy={busy}
                canReorder={canReorder}
                onDragEnd={handleDragEnd}
                onToggleUrgent={(item) =>
                  urgentMut.mutate({
                    id: item.workOrderStepId,
                    isUrgent: !item.isUrgent,
                  })
                }
              />
            ))}
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
