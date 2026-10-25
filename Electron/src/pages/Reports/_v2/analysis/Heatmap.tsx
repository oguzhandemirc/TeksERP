import { RaporGrafik } from "../grafik/RaporGrafik";
import { heatmapOf } from "../custom/result-model";
import type { SemanticResultLite } from "../custom/custom-api";

interface Props {
  result: SemanticResultLite;
  title?: string;
}

/** Isı haritası: iki kırılım (ör. vardiya × saat); hücre sunucunun sayısı, boş hücre çizilmez. */
export function Heatmap({ result, title }: Props) {
  const chart = heatmapOf(result);
  if (!chart) return <p className="text-sm text-muted-foreground">Isı haritası için iki kırılım gerekir.</p>;
  return <RaporGrafik blok={chart} yukseklik={Math.max(220, 48 * chart.seriler.length + 96)} baslik={title ?? chart.eksen.y.ad} />;
}
