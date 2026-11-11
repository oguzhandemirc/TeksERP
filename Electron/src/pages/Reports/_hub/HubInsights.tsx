// Rapor Merkezi analiz kutuları — veri açılış panosunun ucundan (`GET /api/dashboard/pano`): aynı dönem,
// aynı sayı. Kutu yalnız sunucunun döndürdüğü alan kadar çizilir; kapalı/izinsiz alan (null) kutu üretmez.
import { useMemo } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendAreaChart } from "@/components/insight/TrendAreaChart";
import { DonutBreakdown } from "@/components/insight/DonutBreakdown";
import { FilterChip } from "@/components/insight/FilterChipBar";
import { MetricList, MetricListItem } from "@/components/insight/MetricListItem";
import { useTabsStore } from "@/store/tabs";
import { egilimSerileri } from "@/pages/Dashboard/pano/PanoGrafikKutulari";
import { kpiKartlari } from "@/pages/Dashboard/pano/PanoKpiSeridi";
import { degisimRozeti, kovaEtiketi, metre } from "@/pages/Dashboard/pano/pano-bicim";
import { KPI_TARGETS } from "@/pages/Dashboard/pano/pano-hedefler";
import { usePanoErisim } from "@/pages/Dashboard/pano/usePanoErisim";
import { PANO_DONEMLERI, type PanoDonem, type PanoSummary } from "@/pages/Dashboard/pano/types";
import { PERIOD_LABEL } from "./hub-meta";

const PERIOD_OPTIONS = PANO_DONEMLERI.map((d) => ({ value: d, label: PERIOD_LABEL[d] }));

export function PeriodChip({ value, onChange }: { value: PanoDonem; onChange: (d: PanoDonem) => void }) {
  return <FilterChip label="Dönem" value={value} options={PERIOD_OPTIONS} onChange={(v) => v && onChange(v as PanoDonem)} />;
}

export function BoxSkeleton({ title, height = 220 }: { title: string; height?: number }) {
  return (
    <SectionCard title={title}>
      <Skeleton className="w-full" style={{ height }} />
    </SectionCard>
  );
}

interface BoxProps {
  summary: PanoSummary;
  period: PanoDonem;
}

/** Kutunun sağ üstünde dönem adı — seçim üst satırdaki tek dönem çipinden (dört aynı çip yerine). */
function PeriodBadge({ period }: { period: PanoDonem }) {
  return <span className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">{PERIOD_LABEL[period]}</span>;
}

/** "Rapor performansı" karşılığı: dönem içinde üretim ve sevk metresi. Sipariş serisi uçta yok (eklenmez). */
export function TrendBox({ summary, period }: BoxProps) {
  const series = useMemo(() => egilimSerileri(summary.egilim), [summary.egilim]);
  const labels = useMemo(() => summary.egilim.noktalar.map((n) => kovaEtiketi(n.anahtar, summary.egilim.kova)), [summary.egilim]);
  if (series.length === 0) return null;
  return (
    <SectionCard title="Üretim ve sevk eğilimi" description="Metre, dönem içinde" action={<PeriodBadge period={period} />}>
      <TrendAreaChart labels={labels} series={series} formatValue={metre} label="Üretim ve sevk eğilimi" emptyText="Bu dönemde üretim ve sevk yok" height={230} />
    </SectionCard>
  );
}

/** "Genel bakış" halkası karşılığı: dönemde biten metrenin kumaşa dağılımı. */
export function BreakdownBox({ summary, period }: BoxProps) {
  const slices = useMemo(
    () => (summary.dagilim?.dilimler ?? []).map((d) => ({ key: d.itemId ?? d.ad, name: d.ad, value: d.metre, percent: d.yuzde })),
    [summary.dagilim],
  );
  if (!summary.dagilim) return null;
  return (
    <SectionCard title="Üretilen kumaşlar" description="Dönemde biten metre" action={<PeriodBadge period={period} />}>
      <DonutBreakdown slices={slices} formatValue={metre} centerCaption="metre" label="Üretilen kumaş dağılımı"
        emptyText="Bu dönemde biten kumaş yok. Üretim kaydı geldikçe kumaş payları burada görünür." />
    </SectionCard>
  );
}

/** "Öne çıkan sayılar": dönem KPI'ları, önceki eşit pencereye göre değişimle; tık ilgili ekrana gider. */
export function MetricsBox({ summary, period }: BoxProps) {
  const erisim = usePanoErisim();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const cards = kpiKartlari(summary.kpi);
  if (cards.length === 0) return null;
  return (
    <SectionCard title="Öne çıkan sayılar" action={<PeriodBadge period={period} />}>
      <MetricList label="Öne çıkan sayılar">
        {cards.map((c) => {
          const badge = degisimRozeti(c.kpi, period);
          const target = KPI_TARGETS[c.key];
          return (
            <MetricListItem
              key={c.key}
              icon={c.icon}
              tone={c.tone}
              label={c.label}
              value={c.value}
              delta={badge ? { text: badge.yuzde, trend: badge.trend, caption: badge.kiyas, title: badge.metin } : null}
              hint={c.hint}
              onClick={erisim.canGo(target) ? () => navigateActive(target.to) : undefined}
            />
          );
        })}
      </MetricList>
    </SectionCard>
  );
}
