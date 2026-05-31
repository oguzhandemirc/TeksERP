import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarPlus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { workOrderTypeLabels } from "@/types/enums";
import type { WorkOrder } from "@/pages/Operations/WorkOrders/types";
import { fetchUpcomingWorkOrders } from "./dashboardService";

export function UpcomingWorkOrders() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "upcomingWorkOrders"],
    queryFn: fetchUpcomingWorkOrders,
    staleTime: 60_000,
  });

  return (
    <Card className="border-t-2 border-t-warning/60">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <CalendarPlus className="h-4 w-4 text-muted-foreground" />
          Yakında Başlayacak İş Emirleri
        </CardTitle>
        <button
          type="button"
          onClick={() => navigate("/operations/work-orders")}
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
          <EmptyState message="Önümüzdeki 7 gün için planlanan iş emri yok." />
        ) : (
          <ul className="divide-y divide-border/40">
            {data.map((wo) => (
              <WorkOrderRow
                key={wo.id}
                wo={wo}
                onClick={() => navigate(`/operations/work-orders?focus=${wo.id}`)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WorkOrderRow({ wo, onClick }: { wo: WorkOrder; onClick: () => void }) {
  const start = wo.plannedStartDate ? new Date(wo.plannedStartDate) : null;
  const days = start ? daysUntil(start) : null;
  const startsSoon = days !== null && days <= 1;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{wo.batchNumber}</span>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {workOrderTypeLabels[wo.type]}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {wo.targetItem?.name ?? "Hedef ürün yok"}
            {wo.targetColor ? ` • ${wo.targetColor.name}` : ""}
            {wo.targetQuantity ? ` • ${wo.targetQuantity.toLocaleString("tr-TR")} m` : ""}
          </p>
        </div>

        <div className="w-24 text-right">
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              startsSoon && "text-warning",
            )}
          >
            {days === null
              ? "—"
              : days <= 0
                ? "Bugün"
                : days === 1
                  ? "Yarın"
                  : `${days} gün`}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {start
              ? start.toLocaleDateString("tr-TR", {
                  day: "2-digit",
                  month: "short",
                })
              : "—"}
          </p>
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

function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
