import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Zap, Flame } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { shippingQueueStatusLabels } from "@/pages/Operations/ShippingQueue/types";
import type { ShippingQueueItem } from "@/pages/Operations/ShippingQueue/types";
import { fetchShippingQueueItems } from "./dashboardService";

export function UrgentShippingQueue() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "shippingQueueItems"],
    queryFn: fetchShippingQueueItems,
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Zap className="h-4 w-4 text-amber-500" />
          Sevkiyat Kuyruğu
        </CardTitle>
        <button
          type="button"
          onClick={() => navigate("/operations/shipping-queue")}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Tümünü gör →
        </button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingRows />
        ) : isError ? (
          <EmptyState message="Veri alınamadı." />
        ) : !data || data.length === 0 ? (
          <EmptyState message="Sevkiyat kuyruğu boş." />
        ) : (
          <ul className="divide-y divide-border/40">
            {data.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                onClick={() => navigate("/operations/shipping-queue")}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function QueueRow({ item, onClick }: { item: ShippingQueueItem; onClick: () => void }) {
  const { order } = item;
  const totalReq = order.totalRequestedQty ?? 0;
  const totalAlloc = order.totalAllocatedQty ?? 0;
  const progress = totalReq > 0 ? Math.min(100, Math.round((totalAlloc / totalReq) * 100)) : 0;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {item.isUrgent && (
              <Flame className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Acil" />
            )}
            <span className="truncate font-medium">{order.orderNumber}</span>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {shippingQueueStatusLabels[item.status]}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {order.customer?.name ?? "—"}
            {order.branch?.name ? ` • ${order.branch.name}` : ""}
          </p>
        </div>

        <div className="hidden min-w-[110px] text-right sm:block">
          <p className="text-xs text-muted-foreground">Tahsis</p>
          <p className="text-sm font-medium tabular-nums">
            {totalAlloc.toLocaleString("tr-TR")} / {totalReq.toLocaleString("tr-TR")}
            <span className="ml-1 text-muted-foreground">m</span>
          </p>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary/70" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="w-20 text-right">
          {item.assignedOperator ? (
            <p className="truncate text-xs font-medium">{item.assignedOperator.fullName}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Atanmadı</p>
          )}
        </div>
      </button>
    </li>
  );
}

function LoadingRows() {
  return (
    <ul className="divide-y divide-border/40">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-8 w-20" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{message}</p>;
}
