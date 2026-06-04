import { useQuery } from "@tanstack/react-query";
import { AlertOctagon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { workOrderStatusLabels } from "@/types/enums";
import type { WorkOrder } from "@/pages/Operations/WorkOrders/types";
import { useTabsStore } from "@/store/tabs";
import { fetchOverdueWorkOrders } from "./dashboardService";

export function OverdueWorkOrders() {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "overdueWorkOrders"],
    queryFn: fetchOverdueWorkOrders,
    staleTime: 60_000,
  });

  return (
    <Card className="border-t-2 border-t-destructive/60">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <AlertOctagon className="h-4 w-4 text-destructive" />
          Geciken İş Emirleri
        </CardTitle>
        <button
          type="button"
          onClick={() => navigateActive("/operations/work-orders")}
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
          <EmptyState message="Geciken iş emri yok." />
        ) : (
          <ul className="divide-y divide-border/40">
            {data.map((wo) => (
              <WorkOrderRow
                key={wo.id}
                wo={wo}
                onClick={() => navigateActive(`/operations/work-orders?focus=${wo.id}`)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WorkOrderRow({ wo, onClick }: { wo: WorkOrder; onClick: () => void }) {
  const end = wo.plannedEndDate ? new Date(wo.plannedEndDate) : null;
  const overdueDays = end ? daysSince(end) : null;
  const activeStep = wo.steps.find((s) => s.status === "ACTIVE");
  const stationLabel = activeStep?.station?.name ?? "—";

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
              {workOrderStatusLabels[wo.status]}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {wo.targetItem?.name ?? "Hedef ürün yok"}
            {wo.targetColor ? ` • ${wo.targetColor.name}` : ""}
            {activeStep ? ` • ${stationLabel}` : ""}
          </p>
        </div>

        <div className="w-24 text-right">
          <p className="flex items-center justify-end gap-1 text-sm font-semibold tabular-nums text-destructive">
            {overdueDays !== null ? `${overdueDays} gün geçti` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {end
              ? end.toLocaleDateString("tr-TR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
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

function daysSince(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - target.getTime()) / 86_400_000));
}
