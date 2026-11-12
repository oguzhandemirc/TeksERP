import type { UseQueryResult } from "@tanstack/react-query";
import { BoxError } from "@/pages/Dashboard/pano/PanoMovementList";
import type { PanoDonem, PanoSummary } from "@/pages/Dashboard/pano/types";
import type { ReportOpenRecord } from "@/types/preferences";
import { BoxSkeleton, BreakdownBox, MetricsBox, TrendBox } from "./HubInsights";
import { FavoritesColumn, RecentBox, SavedReportsBox, type VisibleMap } from "./HubPersonal";

interface Props {
  /** `null` = pano izni yok → analiz kutuları HİÇ çizilmez (403 isteği de atılmaz). */
  pano: UseQueryResult<PanoSummary> | null;
  period: PanoDonem;
  opened: readonly ReportOpenRecord[];
  favorites: readonly string[];
  visible: VisibleMap;
  onToggleFavorite: (key: string) => void;
  onShowCustom: () => void;
}

function Analytics({ pano, period }: Pick<Props, "period"> & { pano: UseQueryResult<PanoSummary> }) {
  if (pano.isLoading) {
    return (
      <div className="grid gap-4 @[46rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <BoxSkeleton title="Üretim ve sevk eğilimi" height={270} />
        <BoxSkeleton title="Üretilen kumaşlar" height={270} />
      </div>
    );
  }
  if (pano.isError || !pano.data) {
    return <div className="rounded-xl border border-card-border bg-card shadow-card"><BoxError onYenile={() => void pano.refetch()} /></div>;
  }
  const box = { summary: pano.data, period };
  return (
    <div className="grid gap-4 @[46rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <TrendBox {...box} />
      <BreakdownBox {...box} />
    </div>
  );
}

/**
 * Orta bölge (hedef görsel): solda grafikler + alt sırada üç kutu, sağda favoriler sütunu.
 * Kırılımlar sayfanın kendi genişliğinden (container query) — yan menü daralınca da doğru dizilir.
 */
export function HubInsightsRow({ pano, period, opened, favorites, visible, onToggleFavorite, onShowCustom }: Props) {
  const metrics = pano?.data ? <MetricsBox summary={pano.data} period={period} /> : null;
  return (
    <div className="grid items-start gap-4 @[60rem]:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {pano && <Analytics pano={pano} period={period} />}
        <div className="grid items-start gap-4 @[44rem]:grid-cols-2 @[72rem]:grid-cols-3">
          {metrics}
          <RecentBox opened={opened} visible={visible} />
          <SavedReportsBox onShowAll={onShowCustom} />
        </div>
      </div>
      <FavoritesColumn favorites={favorites} opened={opened} visible={visible} onToggleFavorite={onToggleFavorite} />
    </div>
  );
}
