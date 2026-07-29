import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useTabsStore } from "@/store/tabs";
import { summarizeLinkedFulfillment } from "./order-fulfillment";
import { workOrderService } from "./service";
import { WorkOrderDetailHeader } from "./WorkOrderDetailHeader";
import { BranchLanes } from "./BranchLanes";
import { BranchGantt } from "./BranchGantt";
import { FasonStepActions } from "./FasonStepActions";
import { CoverageAlert } from "./detail-v3/CoverageAlert";
import { WorkOrderKpis } from "./detail-v3/WorkOrderKpis";
import { V3Section } from "./detail-v3/V3Section";
import { KunyeCard } from "./detail-v3/KunyeCard";
import { RouteStepline } from "./detail-v3/RouteStepline";
import { ProducedV3 } from "./detail-v3/ProducedV3";
import { OrderLinksV3 } from "./detail-v3/OrderLinksV3";
import "./detail-v3/work-order-detail-v3.css";

const LIST_PATH = "/operations/work-orders";

/**
 * İş emri tam sayfa detayı — "Kurumsal Tasarım v3" (artifact b2bd57a2 birebir).
 * Header korunur (aksiyon wiring'i); gövde `.wo-v3` altında: koşullu kapsama
 * uyarısı, 3-KPI özeti, tam-genişlik künye, daire-node rota + aktif adım kartı,
 * Partiler (fonksiyonel BranchLanes), üretilen ve bağlı siparişler.
 */
export function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const openTarget = useOpenTarget();
  // Parti ayırma akışından geliyorsak refakat kartı yazdırma diyaloğu otomatik açılır.
  const autoPrintTravelerCard = Boolean(
    (location.state as { printTravelerCard?: boolean } | null)?.printTravelerCard,
  );

  const detail = useQuery({
    queryKey: ["work-order-detail", id],
    queryFn: () => workOrderService.getById(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const wo = detail.data?.data ?? null;

  useEffect(() => {
    if (!wo?.workOrderNumber || !id) return;
    const title = `İş Emri · ${wo.workOrderNumber.slice(-6)}`;
    const tab = useTabsStore.getState().tabs.find((t) => t.path === `/operations/work-orders/${id}`);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, title);
  }, [wo?.workOrderNumber, id]);

  const sortedSteps = useMemo(
    () => (wo?.steps ? [...wo.steps].sort((a, b) => a.stepSequence - b.stepSequence) : []),
    [wo?.steps],
  );
  const hasFason = useMemo(
    () => sortedSteps.some((s) => s.station?.type === "EXTERNAL"),
    [sortedSteps],
  );
  const wipSteps = useMemo(
    () => sortedSteps.filter((s) => (s.currentRolls?.count ?? 0) > 0),
    [sortedSteps],
  );
  const hasOrders = (wo?.orderLinks?.length ?? 0) > 0;
  // Bağlı sipariş bölümü — bağ varsa veya stoğa üretimse (OrderLinksV3 stoğa
  // üretimi "siparişe bağlı değil" notuyla gösterir). Sheet'teki showOrders ile aynı.
  const showOrders = hasOrders || wo?.type === "STOCK_PRODUCTION";
  const fulfill = useMemo(() => summarizeLinkedFulfillment(wo?.orderLinks ?? []), [wo?.orderLinks]);

  const holdingStep = wipSteps[0];
  return (
    <PageShell>
      <WorkOrderDetailHeader
        wo={wo}
        onBack={() => openTarget(LIST_PATH)}
        autoOpenTravelerCard={autoPrintTravelerCard}
      />

      <PageBody className="wo-v3">
        <div className="wrap">
          {detail.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-44 w-full" />
            </div>
          )}
          {!detail.isLoading && !wo && (
            <div className="py-16 text-center text-sm text-muted-foreground">İş emri bulunamadı.</div>
          )}

          {wo && (
            // Perf: subtree'yi WO kimliğine key'le (dataUpdatedAt değil) — her refresh'te
            // unmount+remount olmasın.
            <div key={wo.id}>
              {hasOrders && <CoverageAlert requested={fulfill.requested} input={wo.inputRolls?.totalMeters ?? 0} />}

              <WorkOrderKpis wo={wo} fulfill={fulfill} hasOrders={hasOrders} />

              <V3Section title="İş Emri Künyesi">
                <KunyeCard wo={wo} />
              </V3Section>

              {sortedSteps.length > 0 && (
                <V3Section title="Rota & Dağılım" active={wipSteps.length > 0}>
                  <RouteStepline steps={sortedSteps} />
                  {/* Fason adım aksiyonları (Sevk Et / Sonraki Fasona Aktar / Çeki
                      Taslağı) — v2'den v3'e geçerken kaybolmuştu, yalnız detay
                      panelinde kalmıştı. Bileşen kendi kendini gate'ler (fason
                      olmayan / aksiyonsuz adımlar null döner). */}
                  {hasFason &&
                    sortedSteps.map((s) => (
                      <FasonStepActions
                        key={s.id}
                        step={s}
                        steps={sortedSteps}
                        workOrderId={wo.id}
                        withStationLabel
                      />
                    ))}
                </V3Section>
              )}

              {hasFason && wo.id && (
                <V3Section id="partiler" title="Partiler (Fason & Redye)" active={wipSteps.some((s) => s.station?.type === "EXTERNAL")}>
                  <div className="space-y-3">
                    <BranchGantt workOrderId={wo.id} steps={sortedSteps} />
                    <BranchLanes workOrderId={wo.id} steps={sortedSteps} />
                  </div>
                </V3Section>
              )}

              <V3Section title="Üretilen Nihai Toplar">
                <ProducedV3 wo={wo} holdingText={holdingStep ? `${holdingStep.station?.name} adımında` : undefined} />
              </V3Section>

              {showOrders && (
                <V3Section title="Bağlı Sipariş(ler)">
                  <OrderLinksV3 wo={wo} />
                </V3Section>
              )}
            </div>
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}
