import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { AnimatedProgress } from "@/components/motion";
import { formatNumber } from "@/lib/format";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { workOrderService } from "./service";
import { WorkOrderDetailHeader } from "./WorkOrderDetailHeader";
import { WorkOrderInfoCard } from "./WorkOrderInfoCard";
import { RouteDistributionStrip } from "./RouteDistributionStrip";
import { StepWipCard } from "./StepWipCard";
import { BranchGantt } from "./BranchGantt";
import { BranchLanes } from "./BranchLanes";
import { ProducedRollsCard } from "./ProducedRollsCard";
import { OrderLinksCard } from "./OrderLinksCard";

const LIST_PATH = "/operations/work-orders";

/**
 * İş emri tam sayfa detayı (kendi sekmesinde açılır). Slide-over "hızlı bakış"
 * iken bu yüzey her şeyi ferah gösterir: genel bilgi, üretim ilerlemesi, rota
 * dağılımı (şerit + adım kartları), fason dalları (Gantt + lane), üretilen
 * nihai toplar ve bağlı siparişler. Belgeler/İptal aksiyonları başlıkta.
 */
export function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const openTarget = useOpenTarget();

  const detail = useQuery({
    queryKey: ["work-order-detail", id],
    queryFn: () => workOrderService.getById(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const wo = detail.data?.data ?? null;

  const sortedSteps = useMemo(
    () => (wo?.steps ? [...wo.steps].sort((a, b) => a.stepSequence - b.stepSequence) : []),
    [wo?.steps],
  );
  const hasFason = useMemo(
    () => sortedSteps.some((s) => s.station?.type === "EXTERNAL"),
    [sortedSteps],
  );
  const hasOrders = (wo?.orderLinks?.length ?? 0) > 0;
  const orderTotal = useMemo(
    () => (wo?.orderLinks ?? []).reduce((s, l) => s + Number(l.orderLine?.quantity ?? 0), 0),
    [wo?.orderLinks],
  );
  const progress =
    wo?.targetQuantity && wo.targetQuantity > 0 && wo.producedRolls
      ? (wo.producedRolls.warehouse.totalMeters / wo.targetQuantity) * 100
      : null;

  return (
    <div className="flex h-full flex-col">
      <WorkOrderDetailHeader wo={wo} onBack={(e) => openTarget(LIST_PATH, e)} />

      <div className="flex-1 overflow-auto p-4">
        {detail.isLoading && (
          <div className="mx-auto max-w-6xl space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        )}
        {!detail.isLoading && !wo && (
          <div className="py-16 text-center text-sm text-muted-foreground">İş emri bulunamadı.</div>
        )}

        {wo && (
          <div className="mx-auto max-w-6xl space-y-6">
            {/* Üst: Genel bilgi + KPI/ilerleme */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <WorkOrderInfoCard wo={wo} />
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {hasOrders && <Kpi label="Sipariş Toplam" value={`${formatNumber(orderTotal, 0)} m`} />}
                  <Kpi
                    label="Üretime Giren"
                    value={`${formatNumber(wo.inputRolls?.totalMeters ?? 0, 0)} m`}
                    sub={(wo.inputRolls?.count ?? 0) > 0 ? `${wo.inputRolls!.count} top` : undefined}
                  />
                  <Kpi
                    label="Üretilen (depo)"
                    value={`${formatNumber(wo.producedRolls?.warehouse.totalMeters ?? 0, 0)} m`}
                    sub={(wo.producedRolls?.warehouse.count ?? 0) > 0 ? `${wo.producedRolls!.warehouse.count} top` : undefined}
                  />
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Termin</div>
                      <div className="mt-1">
                        <DeadlineBadge deadline={wo.plannedEndDate} />
                      </div>
                    </CardContent>
                  </Card>
                </div>
                {progress != null && (
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Üretim İlerlemesi</span>
                        <span className="font-medium tabular-nums">
                          {formatNumber(wo.producedRolls!.warehouse.totalMeters, 0)} /{" "}
                          {formatNumber(wo.targetQuantity!, 0)} m
                        </span>
                      </div>
                      <AnimatedProgress value={progress} className="mt-2 h-1.5" />
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            <Section title="Rota & Dağılım">
              {sortedSteps.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <RouteDistributionStrip steps={sortedSteps} />
                  </CardContent>
                </Card>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {sortedSteps.map((step) => (
                  <StepWipCard key={step.id} step={step} />
                ))}
              </div>
            </Section>

            {hasFason && wo.id && (
              <Section title="Dallar (Fason Partileri)">
                <BranchGantt workOrderId={wo.id} steps={sortedSteps} />
                <BranchLanes workOrderId={wo.id} />
              </Section>
            )}

            {wo.producedRolls && wo.producedRolls.count > 0 && (
              <Section title="Üretilen Nihai Toplar">
                <ProducedRollsCard wo={wo} />
              </Section>
            )}

            <Section title="Bağlı Siparişler">
              <OrderLinksCard wo={wo} />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 font-medium tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
