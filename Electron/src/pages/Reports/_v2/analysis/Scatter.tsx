import { RaporGrafik } from "../grafik/RaporGrafik";
import { upTo3Text } from "@/lib/number-format";
import type { GrafikBlok } from "../sunum";
import type { AnalysisStatsLite } from "./analysis-model";

interface Props {
  chart: GrafikBlok;
  stats: AnalysisStatsLite | null;
}

/** Saçılım: iki sayısal ölçü, sunucunun eğilim çizgisi, r ve n etiketi (sayılar sunucudan). */
export function Scatter({ chart, stats }: Props) {
  return (
    <figure className="flex flex-col gap-1">
      <RaporGrafik blok={chart} egilim={stats?.egilim ?? null} baslik={`${chart.eksen.x.ad} ve ${chart.eksen.y.ad}`} />
      {stats ? (
        <figcaption className="text-xs text-muted-foreground" data-testid="scatter-label">
          r = {upTo3Text(stats.istatistik)} · n = {upTo3Text(stats.n)}
        </figcaption>
      ) : null}
    </figure>
  );
}
