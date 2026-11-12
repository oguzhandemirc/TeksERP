// Ekran: parça ve matris türleri (halka · ağaç haritası · ısı haritası) → ECharts seçeneği. Saf.
// Halka/ağaç yalnız İLK ana seriyi çizer (kıyas serisi dışarıda); ortada TOPLAM basılmaz (istemci hesap yapmaz).
import { reportCellText, upTo3Text } from "@/lib/number-format";
import type { GrafikBlok } from "../../sunum";
import { kategoriEtiketi, sonlu, valueText } from "../bicim";
import type { ScreenPalette } from "./palet";
import { baseOption, legendOf, type Option, type ScreenOpts } from "./secenekKartezyen";

function slices(blok: GrafikBlok) {
  const s = blok.seriler.find((x) => !x.soluk) ?? blok.seriler[0];
  return {
    name: s?.ad ?? blok.eksen.y.ad,
    data: blok.kategoriler
      .map((k, i) => ({ name: kategoriEtiketi(k, blok.eksen.x.tur), value: s?.veri[i] ?? null }))
      .filter((d): d is { name: string; value: number } => sonlu(d.value) && d.value > 0),
  };
}

export function donutOption(blok: GrafikBlok, p: ScreenPalette, o: ScreenOpts): Option {
  const { name, data } = slices(blok);
  return {
    ...baseOption(p),
    tooltip: { trigger: "item", valueFormatter: (v: unknown) => valueText(v, blok.eksen.y.birim) },
    legend: { ...legendOf(2, p), orient: "vertical", top: "middle", left: "62%", right: 8, itemGap: 10 },
    title: { text: name, left: "31%", top: "middle", textAlign: "center", textStyle: { color: p.ikincil, fontSize: 12, fontWeight: 500, width: 110, overflow: "break" } },
    series: [
      {
        type: "pie",
        name,
        radius: ["50%", "76%"],
        center: ["31%", "50%"],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: p.card, borderWidth: 2 },
        label: o.labels
          ? { show: true, color: p.metin, fontSize: 10, formatter: (x: { percent: number }) => `%${reportCellText(x.percent, "0.0")}` }
          : { show: false },
        labelLine: { show: o.labels, lineStyle: { color: p.ikincil } },
        emphasis: { scale: true, scaleSize: 6 },
        data,
      },
    ],
  };
}

export function treemapOption(blok: GrafikBlok, p: ScreenPalette, o: ScreenOpts): Option {
  const { name, data } = slices(blok);
  return {
    ...baseOption(p),
    tooltip: { trigger: "item", formatter: (x: { name: string; value: number }) => `${x.name}: ${valueText(x.value, blok.eksen.y.birim)}` },
    series: [
      {
        type: "treemap",
        name,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: "100%",
        height: "100%",
        top: 0,
        left: 0,
        itemStyle: { borderColor: p.card, borderWidth: 2, gapWidth: 2, borderRadius: 6 },
        label: {
          show: true,
          color: p.card,
          fontSize: 12,
          fontWeight: 600,
          overflow: "truncate",
          formatter: (x: { name: string; value: number }) => (o.labels ? `${x.name}\n${upTo3Text(x.value)}` : x.name),
        },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: p.renkler[i % p.renkler.length] } })),
      },
    ],
  };
}

/** Isı haritası: satır = seri (kıyas hariç), sütun = kategori; renk birincil tonun açık→koyu skalası. */
/** Bu kadar hücreye kadar ısı haritası değeri hücreye yazar (etiket düğmesinden bağımsız). */
export const HEAT_ALWAYS_LABEL = 24;

export function heatmapOption(blok: GrafikBlok, p: ScreenPalette, o: ScreenOpts): Option {
  const rows = blok.seriler.filter((s) => !s.soluk);
  const cells: [number, number, number][] = [];
  rows.forEach((s, y) => s.veri.forEach((v, x) => (sonlu(v) ? cells.push([x, y, v]) : undefined)));
  const values = cells.map((c) => c[2]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return {
    ...baseOption(p),
    tooltip: {
      trigger: "item",
      formatter: (x: { value: [number, number, number] }) =>
        `${rows[x.value[1]]?.ad ?? ""} · ${kategoriEtiketi(blok.kategoriler[x.value[0]] ?? "", blok.eksen.x.tur)}: ${valueText(x.value[2], blok.eksen.y.birim)}`,
    },
    grid: { left: 8, right: 12, top: 8, bottom: 44, containLabel: true },
    xAxis: { type: "category", data: blok.kategoriler.map((k) => kategoriEtiketi(k, blok.eksen.x.tur)), axisLabel: { color: p.ikincil, hideOverlap: true, width: 120, overflow: "truncate" }, axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false } },
    yAxis: { type: "category", inverse: true, data: rows.map((s) => s.ad), axisLabel: { color: p.ikincil, width: 120, overflow: "truncate" }, axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false } },
    visualMap: {
      min,
      max: max === min ? min + 1 : max,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 140,
      itemWidth: 10,
      calculable: false,
      text: [upTo3Text(max), upTo3Text(min)],
      textStyle: { color: p.ikincil },
      inRange: { color: [p.isiDusuk, p.isiYuksek] },
    },
    series: [
      {
        type: "heatmap",
        name: blok.eksen.y.ad,
        data: cells,
        itemStyle: { borderColor: p.card, borderWidth: 2, borderRadius: 4 },
        // Az hücrede değer hep yazılır: renk tek başına seyrek ızgarada okunmaz.
        label: { show: cells.length <= HEAT_ALWAYS_LABEL || (o.labels && cells.length <= 160), color: p.metin, textBorderColor: p.card, textBorderWidth: 2, fontSize: 10, formatter: (x: { value: [number, number, number] }) => upTo3Text(x.value[2]) },
      },
    ],
  };
}
