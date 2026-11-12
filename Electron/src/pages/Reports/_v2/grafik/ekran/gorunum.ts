// =============================================================================
// Ekran grafiği görünüm kuralları — GrafikBlok'un ŞEKLİNE göre hangi türler sunulur.
// Yalnız ekran: PDF/SVG sunucunun `tur`unu `grafik/secenek.ts` ile çizer (değişmez).
// Kural: veriye uymayan tür PASİF kalır ve nedeni ipucunda yazar (gizlenmez).
// =============================================================================
import type { GrafikBlok } from "../../sunum";
import { sonlu } from "../bicim";

export const CHART_KINDS = ["line", "area", "bar", "hbar", "stacked", "donut", "treemap", "heatmap", "pareto", "scatter", "native"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** Seçicide görünen türler (sıra = düğme sırası); `native` seçici taşımayan özgün türdür. */
export const SELECTABLE_KINDS: readonly ChartKind[] = ["line", "area", "bar", "hbar", "stacked", "donut", "treemap", "heatmap", "pareto", "scatter"];

export const KIND_LABEL: Readonly<Record<ChartKind, string>> = {
  line: "Çizgi",
  area: "Alan",
  bar: "Sütun",
  hbar: "Yatay çubuk",
  stacked: "Yığılmış sütun",
  donut: "Halka",
  treemap: "Ağaç haritası",
  heatmap: "Isı haritası",
  pareto: "Pareto",
  scatter: "Dağılım",
  native: "Özgün",
};

/** Halka dilimi okunabilir kalsın diye kategori tavanı. */
export const DONUT_MAX_CATEGORIES = 12;

export interface KindOption {
  kind: ChartKind;
  enabled: boolean;
  /** Pasifse nedeni (ipucu). */
  reason?: string;
}

export interface ChartShape {
  /** Kıyas (`soluk`) olmayan seri sayısı. */
  mainSeries: number;
  hasCompare: boolean;
  categories: number;
  x: GrafikBlok["eksen"]["x"]["tur"];
  negative: boolean;
  source: GrafikBlok["tur"];
}

export function chartShape(blok: GrafikBlok): ChartShape {
  const main = blok.seriler.filter((s) => !s.soluk);
  return {
    mainSeries: main.length,
    hasCompare: blok.seriler.some((s) => s.soluk),
    categories: blok.kategoriler.length,
    x: blok.eksen.x.tur,
    negative: main.some((s) => s.veri.some((v) => sonlu(v) && v < 0)),
    source: blok.tur,
  };
}

const R = {
  native: "Bu grafik kendi türünde okunur",
  scatter: "Dağılım iki sayısal ölçü ister",
  numericX: "Sayısal eksende yalnız dağılım anlamlı",
  timePart: "Zaman serisinde parça/pay grafiği yanıltır",
  catLine: "Kategori verisinde çizgi sıra varmış gibi gösterir",
  multi: "Tek ölçülü veride kullanılamaz (en az iki seri gerekir)",
  single: "Çok serili veride kullanılamaz (tek seri gerekir)",
  negative: "Eksi değer parça/pay grafiğinde gösterilemez",
  donutMany: `${DONUT_MAX_CATEGORIES}'den çok dilim okunmaz`,
  paretoFew: "Pareto en az üç kategori ister",
  heatTime: "Isı haritası için en az iki seri gerekir",
} as const;

function decide(kind: ChartKind, s: ChartShape): string | null {
  if (s.source === "kutu" || s.source === "kucukCoklu") return kind === "native" ? null : R.native;
  if (kind === "native") return R.native;
  if (s.source === "sacilim" || s.x === "sayi") return kind === "scatter" ? null : R.numericX;
  if (kind === "scatter") return R.scatter;
  const part = kind === "donut" || kind === "treemap" || kind === "pareto";
  if (s.source === "isiHaritasi") {
    if (kind === "heatmap" || kind === "bar" || kind === "hbar" || kind === "stacked") return null;
    return kind === "line" || kind === "area" ? R.catLine : R.single;
  }
  if (s.x === "zaman") {
    if (kind === "line" || kind === "area" || kind === "bar") return null;
    if (kind === "stacked" || kind === "heatmap") return s.mainSeries >= 2 ? null : kind === "heatmap" ? R.heatTime : R.multi;
    return part ? R.timePart : R.catLine;
  }
  // kategori ekseni
  if (kind === "line" || kind === "area") return R.catLine;
  if (kind === "bar" || kind === "hbar") return null;
  if (kind === "stacked" || kind === "heatmap") return s.mainSeries >= 2 ? null : R.multi;
  if (s.mainSeries !== 1) return R.single;
  if (s.negative) return R.negative;
  if (kind === "donut" && s.categories > DONUT_MAX_CATEGORIES) return R.donutMany;
  if (kind === "pareto" && s.categories < 3) return R.paretoFew;
  return null;
}

/** Seçicinin düğmeleri: her tür etkin mi, değilse neden. Özgün türde yalnız `native` döner. */
export function kindOptions(blok: GrafikBlok): KindOption[] {
  const s = chartShape(blok);
  if (s.source === "kutu" || s.source === "kucukCoklu") return [{ kind: "native", enabled: true }];
  return SELECTABLE_KINDS.map((kind) => {
    const reason = decide(kind, s);
    return reason ? { kind, enabled: false, reason } : { kind, enabled: true };
  });
}

const FROM_SERVER: Readonly<Record<GrafikBlok["tur"], ChartKind>> = {
  cizgi: "line",
  cubuk: "bar",
  yiginCubuk: "stacked",
  pasta: "donut",
  isiHaritasi: "heatmap",
  sacilim: "scatter",
  kutu: "native",
  kucukCoklu: "native",
};

/** Sunucunun `tur`unun ekran karşılığı; uymuyorsa (ör. 30 dilimli pasta) ilk etkin tür. */
export function defaultKind(blok: GrafikBlok): ChartKind {
  const opts = kindOptions(blok);
  const wanted = FROM_SERVER[blok.tur];
  if (opts.some((o) => o.kind === wanted && o.enabled)) return wanted;
  return opts.find((o) => o.enabled)?.kind ?? "native";
}

/** Kullanıcı tercihi bu veriye uyuyorsa o, değilse varsayılan (tercih SİLİNMEZ; veri değişince geri gelir). */
export function resolveKind(blok: GrafikBlok, preferred: string | undefined): ChartKind {
  const hit = kindOptions(blok).find((o) => o.kind === preferred && o.enabled);
  return hit ? hit.kind : defaultKind(blok);
}
