import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
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
import { AnimatedNumber } from "@/components/motion";
import { springSnappy, staggerContainer, staggerItem } from "@/lib/motion";
import { STATION_TEXT } from "@/lib/station-colors";
import { useTabsStore } from "@/store/tabs";
import {
  fetchOpenOrderCount,
  fetchOpenWorkOrderCount,
  fetchProductionActiveRollCount,
  fetchRollCount,
} from "./dashboardService";
import { useDashboardLayout } from "./useDashboardLayout";
import { useRoleAccess } from "@/hooks/useRoleAccess";

interface KpiDef {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: string;
  query: () => Promise<number>;
  /** O8 fix: backend endpoint'inin istediği izin — yoksa kart hiç render edilmez
   *  ve sorgu HİÇ atılmaz (dar yetkili kullanıcıda login anında 403 toast
   *  fırtınası yaşanıyordu; canEnterApp tek izinle bile geçer). */
  permission: string;
  /** Tıklandığında gidilecek route — query string ile filtre/tab taşır. */
  to?: string;
}

const KPIS: KpiDef[] = [
  {
    key: "openOrders",
    label: "Açık Sipariş",
    icon: ClipboardList,
    tone: "text-info",
    query: fetchOpenOrderCount,
    permission: "order:read",
    to: "/operations/orders?filter[status]=PENDING,APPROVED,PARTIAL_SHIPPED",
  },
  {
    key: "openWorkOrders",
    label: "Açık İş Emri",
    icon: Factory,
    tone: "text-primary",
    query: fetchOpenWorkOrderCount,
    permission: "workorder:read",
    to: "/operations/work-orders?filter[status]=PLANNED,IN_PROGRESS,PAUSED",
  },
  {
    key: "warehouse",
    label: "Depoda Bekleyen",
    icon: Warehouse,
    tone: STATION_TEXT.depo,
    query: () => fetchRollCount("WAREHOUSE"),
    permission: "roll:read",
    to: "/operations/rolls?tab=FINISHED_STOCK",
  },
  {
    key: "atSubcontractor",
    label: "Fason'da",
    icon: Truck,
    tone: STATION_TEXT.fason,
    query: () => fetchRollCount("AT_SUBCONTRACTOR"),
    permission: "roll:read",
    to: "/operations/rolls?tab=SUBCONTRACTOR",
  },
  {
    key: "inProduction",
    label: "Üretimde",
    icon: Cog,
    tone: STATION_TEXT.process,
    query: fetchProductionActiveRollCount,
    permission: "roll:read",
    to: "/operations/rolls?tab=PRODUCTION",
  },
];

export function KpiCards() {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { hasPermission } = useRoleAccess();
  const { isVisible, itemOrder } = useDashboardLayout();
  const kpiByFullKey = new Map(KPIS.map((k) => [`kpi:${k.key}`, k]));
  const visibleKpis = itemOrder("kpi")
    .filter((fullKey) => isVisible(fullKey))
    .map((fullKey) => kpiByFullKey.get(fullKey))
    .filter((k): k is KpiDef => Boolean(k))
    .filter((k) => hasPermission(k.permission));

  const results = useQueries({
    queries: visibleKpis.map((k) => ({
      queryKey: ["dashboard", "kpi", k.key],
      queryFn: k.query,
      staleTime: 60_000,
    })),
  });

  if (visibleKpis.length === 0) return null;

  return (
    <motion.div
      className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {visibleKpis.map((kpi, i) => {
        const r = results[i]!;
        const Icon = kpi.icon;
        const clickable = Boolean(kpi.to);
        return (
          <motion.div
            key={kpi.key}
            variants={staggerItem}
            whileHover={clickable ? { y: -3 } : undefined}
            transition={springSnappy}
          >
            <Card
              onClick={clickable ? () => navigateActive(kpi.to!) : undefined}
              className={cn(
                "relative h-full overflow-hidden bg-gradient-to-br from-primary/5 to-transparent",
                clickable && "card-glow cursor-pointer",
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -bottom-3 -right-2 h-20 w-20 opacity-[0.06]",
                  kpi.tone,
                )}
              />
              <CardContent className="relative flex items-center gap-3 p-4">
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-current/10",
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
                    <AnimatedNumber
                      value={r.data ?? 0}
                      flash
                      className="block text-2xl font-semibold leading-tight tabular-nums"
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
