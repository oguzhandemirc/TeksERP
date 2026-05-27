import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Factory,
  Warehouse,
  Truck,
  Cog,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  fetchOpenOrderCount,
  fetchOpenWorkOrderCount,
  fetchProductionActiveRollCount,
  fetchRollCount,
} from "./dashboardService";
import { useDashboardLayout } from "./useDashboardLayout";

interface KpiDef {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: string;
  query: () => Promise<number>;
  /** Tıklandığında gidilecek route — query string ile filtre/tab taşır. */
  to?: string;
}

const KPIS: KpiDef[] = [
  {
    key: "openOrders",
    label: "Açık Sipariş",
    icon: ClipboardList,
    tone: "text-blue-600 dark:text-blue-400",
    query: fetchOpenOrderCount,
    to: "/operations/orders?filter[status]=PENDING,APPROVED,PARTIAL_SHIPPED",
  },
  {
    key: "openWorkOrders",
    label: "Açık İş Emri",
    icon: Factory,
    tone: "text-violet-600 dark:text-violet-400",
    query: fetchOpenWorkOrderCount,
    to: "/operations/work-orders?filter[status]=PLANNED,IN_PROGRESS,PAUSED",
  },
  {
    key: "warehouse",
    label: "Depoda Bekleyen",
    icon: Warehouse,
    tone: "text-amber-600 dark:text-amber-400",
    query: () => fetchRollCount("WAREHOUSE"),
    to: "/operations/rolls?tab=FINISHED_STOCK",
  },
  {
    key: "atSubcontractor",
    label: "Fason'da",
    icon: Truck,
    tone: "text-orange-600 dark:text-orange-400",
    query: () => fetchRollCount("AT_SUBCONTRACTOR"),
    to: "/operations/rolls?tab=SUBCONTRACTOR",
  },
  {
    key: "inProduction",
    label: "Üretimde",
    icon: Cog,
    tone: "text-indigo-600 dark:text-indigo-400",
    query: fetchProductionActiveRollCount,
    to: "/operations/rolls?tab=PRODUCTION",
  },
];

export function KpiCards() {
  const navigate = useNavigate();
  const { isVisible, itemOrder } = useDashboardLayout();
  const kpiByFullKey = new Map(KPIS.map((k) => [`kpi:${k.key}`, k]));
  const visibleKpis = itemOrder("kpi")
    .filter((fullKey) => isVisible(fullKey))
    .map((fullKey) => kpiByFullKey.get(fullKey))
    .filter((k): k is KpiDef => Boolean(k));

  const results = useQueries({
    queries: visibleKpis.map((k) => ({
      queryKey: ["dashboard", "kpi", k.key],
      queryFn: k.query,
      staleTime: 60_000,
    })),
  });

  if (visibleKpis.length === 0) return null;

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
      {visibleKpis.map((kpi, i) => {
        const r = results[i]!;
        const Icon = kpi.icon;
        const clickable = Boolean(kpi.to);
        return (
          <Card
            key={kpi.key}
            onClick={clickable ? () => navigate(kpi.to!) : undefined}
            className={cn(
              clickable &&
                "cursor-pointer transition-colors hover:bg-accent/40 hover:border-primary/40",
            )}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted",
                  kpi.tone,
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-muted-foreground">
                  {kpi.label}
                </p>
                {r.isLoading ? (
                  <Skeleton className="mt-1 h-7 w-12" />
                ) : r.isError ? (
                  <p className="mt-0.5 text-lg font-semibold text-muted-foreground">—</p>
                ) : (
                  <p className="text-2xl font-semibold leading-tight">{r.data}</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
