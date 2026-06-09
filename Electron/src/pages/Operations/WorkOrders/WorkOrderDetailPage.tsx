import { useEffect, useMemo, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useTabsStore } from "@/store/tabs";
import { AnimatedNumber, FadeInUp } from "@/components/motion";
import { workOrderService } from "./service";
import { WorkOrderDetailHeader } from "./WorkOrderDetailHeader";
import { WorkOrderHealthBand } from "./WorkOrderHealthBand";
import { WorkOrderSectionNav, type NavSection } from "./WorkOrderSectionNav";
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
  const location = useLocation();
  const openTarget = useOpenTarget();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Parti ayırma akışından geliyorsak refakat kartı yazdırma diyaloğu otomatik
  // açılır — yeni kart basılıp ayrılan demete takılmalı (eski kart yanlış WO).
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
    if (!wo?.batchNumber || !id) return;
    const suffix = wo.batchNumber.slice(-6);
    const title = `İş Emri · ${suffix}`;
    const tab = useTabsStore.getState().tabs.find((t) => t.path === `/operations/work-orders/${id}`);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, title);
  }, [wo?.batchNumber, id]);

  const sortedSteps = useMemo(
    () => (wo?.steps ? [...wo.steps].sort((a, b) => a.stepSequence - b.stepSequence) : []),
    [wo?.steps],
  );
  const hasFason = useMemo(
    () => sortedSteps.some((s) => s.station?.type === "EXTERNAL"),
    [sortedSteps],
  );
  const hasOrders = (wo?.orderLinks?.length ?? 0) > 0;
  const hasProduced = (wo?.producedRolls?.count ?? 0) > 0;
  const orderTotal = useMemo(
    () => (wo?.orderLinks ?? []).reduce((s, l) => s + Number(l.orderLine?.quantity ?? 0), 0),
    [wo?.orderLinks],
  );

  const navSections = useMemo<NavSection[]>(() => {
    const list: NavSection[] = [
      { id: "genel", label: "Genel" },
      { id: "rota", label: "Rota & Dağılım" },
    ];
    if (hasFason) list.push({ id: "dallar", label: "Dallar" });
    if (hasProduced) list.push({ id: "cikti", label: "Üretilen" });
    list.push({ id: "siparis", label: "Siparişler" });
    return list;
  }, [hasFason, hasProduced]);

  return (
    <div className="flex h-full flex-col">
      <WorkOrderDetailHeader
        wo={wo}
        onBack={(e) => openTarget(LIST_PATH, e)}
        autoOpenTravelerCard={autoPrintTravelerCard}
      />

      <div ref={scrollRef} className="flex-1 overflow-auto">
        {wo && <WorkOrderSectionNav sections={navSections} scrollRef={scrollRef} />}

        <div className="p-4">
          {detail.isLoading && (
            <div className="mx-auto max-w-6xl space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-44 w-full" />
            </div>
          )}
          {!detail.isLoading && !wo && (
            <div className="py-16 text-center text-sm text-muted-foreground">İş emri bulunamadı.</div>
          )}

          {wo && (
            <div key={detail.dataUpdatedAt} className="mx-auto max-w-6xl space-y-6">
              <FadeInUp delay={0}>
                <WorkOrderHealthBand wo={wo} />
              </FadeInUp>

              <FadeInUp delay={0.08}>
                <section id="genel" className="grid scroll-mt-16 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <WorkOrderInfoCard wo={wo} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 content-start lg:grid-cols-1">
                    <Kpi
                      label="Üretime Giren"
                      value={wo.inputRolls?.totalMeters ?? 0}
                      unit="m"
                      sub={(wo.inputRolls?.count ?? 0) > 0 ? `${wo.inputRolls!.count} top` : undefined}
                    />
                    {hasOrders && (
                      <Kpi label="Sipariş Toplam" value={orderTotal} unit="m" />
                    )}
                  </div>
                </section>
              </FadeInUp>

              <FadeInUp delay={0.16}>
                <Section id="rota" title="Rota & Dağılım">
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
              </FadeInUp>

              {hasFason && wo.id && (
                <FadeInUp delay={0.24}>
                  <Section id="dallar" title="Dallar (Fason Partileri)">
                    <BranchGantt workOrderId={wo.id} steps={sortedSteps} />
                    <BranchLanes workOrderId={wo.id} />
                  </Section>
                </FadeInUp>
              )}

              {hasProduced && (
                <FadeInUp delay={0.32}>
                  <Section id="cikti" title="Üretilen Nihai Toplar">
                    <ProducedRollsCard wo={wo} />
                  </Section>
                </FadeInUp>
              )}

              <FadeInUp delay={0.4}>
                <Section id="siparis" title="Bağlı Siparişler">
                  <OrderLinksCard wo={wo} />
                </Section>
              </FadeInUp>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: number; unit?: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 font-medium tabular-nums">
          <AnimatedNumber value={value} /> {unit}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
