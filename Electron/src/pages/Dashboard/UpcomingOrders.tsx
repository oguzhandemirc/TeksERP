import { useQuery } from "@tanstack/react-query";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedProgress } from "@/components/motion";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { orderStatusLabels } from "@/types/enums";
import type { Order } from "@/pages/Operations/Orders/types";
import { useTabsStore } from "@/store/tabs";
import { fetchUpcomingOrders } from "./dashboardService";

export function UpcomingOrders() {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "upcomingOrders"],
    queryFn: fetchUpcomingOrders,
    staleTime: 60_000,
  });

  return (
    <Card className="border-t-2 border-t-info/60">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Vadesi Yaklaşan Siparişler
        </CardTitle>
        <button
          type="button"
          onClick={() => navigateActive("/operations/orders")}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Tümünü gör →
        </button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingRows />
        ) : isError ? (
          <EmptyState icon={AlertTriangle} title="Veri alınamadı" />
        ) : !data || data.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Vadesi belirlenmiş açık sipariş yok" />
        ) : (
          <ul className="divide-y divide-border/40">
            {data.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onClick={() => navigateActive(`/operations/orders?focus=${order.id}`)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OrderRow({ order, onClick }: { order: Order; onClick: () => void }) {
  const deadline = order.deadline ? new Date(order.deadline) : null;
  const days = deadline ? daysUntil(deadline) : null;
  const totalQty = order.lines.reduce((sum, l) => sum + (l.quantity ?? 0), 0);
  const progress =
    totalQty > 0 ? Math.min(100, Math.round((order.shippedQty / totalQty) * 100)) : 0;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{order.orderNumber}</span>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {orderStatusLabels[order.status]}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {order.customer?.name ?? "—"}
          </p>
        </div>

        <div className="hidden min-w-[110px] text-right sm:block">
          <p className="text-xs text-muted-foreground">İlerleme</p>
          <p className="text-sm font-medium tabular-nums">
            {order.shippedQty.toLocaleString("tr-TR")} / {totalQty.toLocaleString("tr-TR")}
            <span className="ml-1 text-muted-foreground">m</span>
          </p>
          <AnimatedProgress value={progress} className="mt-1 h-1" barClassName="bg-primary/70" />
        </div>

        <DeadlineBadge days={days} deadline={deadline} />
      </button>
    </li>
  );
}

function DeadlineBadge({ days, deadline }: { days: number | null; deadline: Date | null }) {
  if (days === null || !deadline) {
    return <span className="w-20 text-right text-xs text-muted-foreground">—</span>;
  }
  const overdue = days < 0;
  const urgent = days >= 0 && days <= 3;
  return (
    <div className="w-24 text-right">
      <p
        className={cn(
          "flex items-center justify-end gap-1 text-sm font-semibold tabular-nums",
          overdue && "text-destructive",
          urgent && "text-warning",
        )}
      >
        {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
        {overdue ? `${Math.abs(days)} gün geçti` : days === 0 ? "Bugün" : `${days} gün`}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {deadline.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" })}
      </p>
    </div>
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

function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - today.getTime();
  return Math.round(diff / 86_400_000);
}
