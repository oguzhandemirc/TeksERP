// Ekran grafiği seçeneği — seçilen türe göre tek giriş. Özgün türler (dağılım, kutu, küçük çoklu)
// ortak `grafikSecenek`e ekran paletiyle gider; PDF/SVG yolu (`baski`) burada HİÇ çağrılmaz.
import type { GrafikBlok } from "../../sunum";
import { grafikBosMu } from "../bicim";
import { grafikSecenek } from "../secenek";
import type { ChartKind } from "./gorunum";
import type { ScreenPalette } from "./palet";
import { cartesianOption, type Option, type ScreenOpts } from "./secenekKartezyen";
import { donutOption, heatmapOption, treemapOption } from "./secenekDiger";

export function screenOption(blok: GrafikBlok, kind: ChartKind, p: ScreenPalette, o: ScreenOpts): Option {
  if (grafikBosMu(blok)) return grafikSecenek(blok, p);
  switch (kind) {
    case "donut":
      return donutOption(blok, p, o);
    case "treemap":
      return treemapOption(blok, p, o);
    case "heatmap":
      return heatmapOption(blok, p, o);
    case "scatter":
    case "native":
      return grafikSecenek(blok, p, { egilim: o.egilim });
    default:
      return cartesianOption(blok, kind, p, o);
  }
}

/** Kapsayıcı yüksekliği: yatay çubuk kategori başına büyür (30+ kategoride okunur kalır). */
export function chartHeight(blok: GrafikBlok, kind: ChartKind, base: number): number {
  if (kind === "hbar") return Math.min(1200, Math.max(base, blok.kategoriler.length * 28 + 70));
  // Isı haritası satır başına büyür; az satırda tabana gerilmez (2×2 dev blok olmasın).
  if (kind === "heatmap") return Math.max(180, blok.seriler.filter((s) => !s.soluk).length * 44 + 100);
  return base;
}
