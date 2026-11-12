// Ekran: eksenli türler (çizgi · alan · sütun · yatay çubuk · yığılmış · pareto) → ECharts seçeneği.
// Saf; echarts import ETMEZ. Değer/etiket metni `bicim` + `lib/number-format`ten (tablo ile aynı biçim).
import { upTo3Text } from "@/lib/number-format";
import type { GrafikBlok, GrafikSerisi } from "../../sunum";
import { kategoriEtiketi, sonlu, valueText } from "../bicim";
import type { ChartKind } from "./gorunum";
import type { ScreenPalette } from "./palet";

export type Option = Record<string, unknown>;
export interface ScreenOpts {
  /** Veri etiketleri açık mı. */
  labels: boolean;
  /** Saçılımda sunucunun eğilim çizgisi uçları (yalnız özgün türe gider). */
  egilim?: [[number, number], [number, number]] | null;
}

/** Seri kurucularının ortak bağlamı. */
interface Ctx {
  blok: GrafikBlok;
  kind: ChartKind;
  p: ScreenPalette;
  o: ScreenOpts;
}

/** Bu kategori sayısından sonra yatay kaydırma (dataZoom) açılır. */
export const ZOOM_AFTER = 24;

export function baseOption(p: ScreenPalette): Option {
  return {
    animationDuration: 500,
    backgroundColor: "transparent",
    color: p.renkler,
    textStyle: { fontFamily: p.yaziTipi, color: p.metin, fontSize: 11 },
  };
}

export function legendOf(count: number, p: ScreenPalette): Option | undefined {
  if (count < 2) return undefined;
  return { type: "scroll", top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, itemGap: 14, textStyle: { color: p.ikincil, fontSize: 11 } };
}

function valueAxis(p: ScreenPalette, extra: Option = {}): Option {
  return {
    type: "value",
    // Ölçü adı kart başlığında; eksende tekrar edilmez (dar kartta yer kaplar).
    name: "",
    axisLabel: { color: p.ikincil, formatter: (v: number) => upTo3Text(v) },
    splitLine: { lineStyle: { color: p.izgara, type: "dashed" } },
    ...extra,
  };
}

function categoryAxis(blok: GrafikBlok, p: ScreenPalette, data: string[], extra: Option = {}): Option {
  return {
    type: "category",
    data,
    axisLabel: { color: p.ikincil, hideOverlap: true, ...(data.length <= 12 && blok.eksen.x.tur === "kategori" ? { interval: 0, width: 110, overflow: "truncate" } : {}) },
    axisLine: { lineStyle: { color: p.izgara } },
    axisTick: { show: false },
    ...extra,
  };
}

const labelOf = (on: boolean, position: string, p: ScreenPalette): Option => ({
  show: on,
  position,
  color: p.ikincil,
  fontSize: 10,
  formatter: (x: { value: unknown }) => (sonlu(x.value) ? upTo3Text(x.value) : ""),
});

const zoomOf = (count: number, axis: "x" | "y"): Option[] | undefined =>
  count > ZOOM_AFTER
    ? [
        { type: "inside", [`${axis}AxisIndex`]: 0 },
        { type: "slider", [`${axis}AxisIndex`]: 0, height: 14, bottom: 4, brushSelect: false, showDetail: false },
      ]
    : undefined;

function vGradient(p: ScreenPalette, i: number, top: number, bottom: number): Option {
  return { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: p.fade(i, top) }, { offset: 1, color: p.fade(i, bottom) }] };
}

function lineSeries(s: GrafikSerisi, i: number, { kind, blok, p, o }: Ctx): Option {
  if (s.soluk) {
    return { type: "line", name: s.ad, data: s.veri, z: 1, symbol: "none", lineStyle: { width: 1.6, type: "dashed" }, color: p.soluk, label: labelOf(false, "top", p) };
  }
  return {
    type: "line",
    name: s.ad,
    data: s.veri,
    z: 3,
    smooth: 0.25,
    // Eğri ara noktada veriyi aşmasın (tepe/çukur uydurmasın).
    smoothMonotone: "x",
    connectNulls: false,
    symbol: "circle",
    symbolSize: 7,
    showSymbol: blok.kategoriler.length <= 40,
    lineStyle: { width: 2.6 },
    emphasis: { focus: "series" },
    ...(kind === "area" ? { areaStyle: { color: vGradient(p, i, 0.38, 0.02) } } : {}),
    label: labelOf(o.labels, "top", p),
  };
}

function barSeries(s: GrafikSerisi, i: number, { kind, p, o }: Ctx, look: { last: boolean; colorful: boolean }): Option {
  const { last, colorful } = look;
  const horizontal = kind === "hbar";
  const stacked = kind === "stacked";
  const radius = stacked && !last ? 0 : horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0];
  return {
    type: "bar",
    name: s.ad,
    data: s.veri,
    barMaxWidth: horizontal ? 22 : 42,
    ...(stacked ? { stack: "toplam" } : {}),
    ...(colorful ? { colorBy: "data" } : {}),
    itemStyle: s.soluk ? { color: p.soluk, opacity: 0.45, borderRadius: radius } : { borderRadius: radius, ...(colorful || stacked ? {} : { color: vGradient(p, i, 1, 0.55) }) },
    emphasis: { focus: "series" },
    label: labelOf(o.labels && !s.soluk, stacked ? "inside" : horizontal ? "right" : "top", p),
  };
}

/** Pareto: büyükten küçüğe dizilmiş sütun + birikimli pay çizgisi (görsel; ipucunda yeni sayı basılmaz). */
function pareto(blok: GrafikBlok, p: ScreenPalette, o: ScreenOpts): Option {
  const s = blok.seriler.find((x) => !x.soluk)!;
  const order = blok.kategoriler.map((_, i) => i).sort((a, b) => (s.veri[b] ?? 0) - (s.veri[a] ?? 0));
  const values = order.map((i) => s.veri[i] ?? null);
  const total = values.reduce<number>((a, v) => a + (sonlu(v) ? v : 0), 0);
  let run = 0;
  const cumulative = values.map((v) => {
    run += sonlu(v) ? v : 0;
    return total > 0 ? (run / total) * 100 : null;
  });
  const cats = order.map((i) => kategoriEtiketi(blok.kategoriler[i]!, blok.eksen.x.tur));
  return {
    ...baseOption(p),
    legend: legendOf(2, p),
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => valueText(v, blok.eksen.y.birim) },
    grid: { left: 8, right: 8, top: 40, bottom: cats.length > ZOOM_AFTER ? 30 : 8, containLabel: true },
    dataZoom: zoomOf(cats.length, "x"),
    xAxis: categoryAxis(blok, p, cats),
    yAxis: [
      valueAxis(p),
      { type: "value", min: 0, max: 100, name: "Birikimli pay", nameTextStyle: { color: p.ikincil }, axisLabel: { color: p.ikincil, formatter: "%{value}" }, splitLine: { show: false } },
    ],
    series: [
      { ...barSeries({ ad: s.ad, veri: values }, 0, { blok, kind: "bar", p, o }, { last: true, colorful: false }) },
      { type: "line", name: "Birikimli pay", yAxisIndex: 1, data: cumulative, smooth: 0.2, symbol: "circle", symbolSize: 6, color: p.renkler[2] ?? p.renkler[0], tooltip: { show: false }, lineStyle: { width: 2 } },
    ],
  };
}

export function cartesianOption(blok: GrafikBlok, kind: ChartKind, p: ScreenPalette, o: ScreenOpts): Option {
  if (kind === "pareto") return pareto(blok, p, o);
  const cats = blok.kategoriler.map((k) => kategoriEtiketi(k, blok.eksen.x.tur));
  const horizontal = kind === "hbar";
  const line = kind === "line" || kind === "area";
  const mains = blok.seriler.filter((s) => !s.soluk);
  // Tek serili kategori sütunu her çubuğu ayrı tonla boyar (zaman serisinde tek ton kalır).
  const colorful = !line && kind !== "stacked" && mains.length === 1 && blok.seriler.length === 1 && blok.eksen.x.tur === "kategori";
  const lastMain = blok.seriler.lastIndexOf(mains[mains.length - 1]!);
  const legend = legendOf(blok.seriler.length, p);
  const zoom = horizontal ? undefined : zoomOf(cats.length, "x");
  const catAxis = categoryAxis(blok, p, cats, horizontal ? { inverse: true } : line ? { boundaryGap: false } : {});
  const valAxis = valueAxis(p);
  return {
    ...baseOption(p),
    legend,
    tooltip: { trigger: "axis", axisPointer: { type: line ? "line" : "shadow" }, valueFormatter: (v: unknown) => valueText(v, blok.eksen.y.birim) },
    grid: { left: 8, right: horizontal ? 40 : 12, top: legend ? 40 : 30, bottom: zoom ? 30 : 8, containLabel: true },
    dataZoom: zoom,
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    series: blok.seriler.map((s, i) => (line ? lineSeries(s, i, { blok, kind, p, o }) : barSeries(s, i, { blok, kind, p, o }, { last: i === lastMain, colorful }))),
  };
}
