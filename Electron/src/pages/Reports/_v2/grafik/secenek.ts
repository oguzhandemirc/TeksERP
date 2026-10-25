// =============================================================================
// GrafikBlok → ECharts seçenek nesnesi (saf; echarts'ı import ETMEZ — tembel yükleme
// `motor.ts`te). Ekran (canvas) ve baskı (SVG) AYNI seçeneği çizer; fark yalnız tema
// ve `baski` bayrağıdır (baskıda tooltip/animasyon yok). Sayı `lib/number-format`,
// tarih `lib/factory-time` ile biçimlenir — eksen ve tablo aynı metni basar.
// =============================================================================

import { reportCellText, upTo3Text } from "@/lib/number-format";
import { GRAFIK_VERI_YOK, valueText, grafikBosMu, kategoriEtiketi, kutuIstatistigi, niceCeiling, sonlu, unitText } from "./bicim";
import type { GrafikBlok } from "../sunum";
import type { GrafikTema } from "./tema";

export { GRAFIK_VERI_YOK, valueText, grafikBosMu, kategoriEtiketi, kutuIstatistigi } from "./bicim";

export type GrafikSecenek = Record<string, unknown>;
/** Saçılım eğilim çizgisi uçları `[[x1, y1], [x2, y2]]` (sunucu `istatistik.egilim`). */
export type Egilim = [[number, number], [number, number]];

function ortak(tema: GrafikTema, baski: boolean): GrafikSecenek {
  return {
    animation: !baski,
    backgroundColor: tema.zemin,
    color: tema.renkler,
    textStyle: { fontFamily: tema.yaziTipi, color: tema.metin, fontSize: 11 },
  };
}

function lejant(blok: GrafikBlok, tema: GrafikTema): GrafikSecenek | undefined {
  if (blok.seriler.length < 2) return undefined;
  return { top: 0, left: "center", itemWidth: 14, itemHeight: 8, textStyle: { color: tema.ikincil, fontSize: 11 } };
}

function valueAxis(blok: GrafikBlok, tema: GrafikTema, ek: GrafikSecenek = {}): GrafikSecenek {
  const birim = unitText(blok.eksen.y.birim);
  return {
    type: "value",
    name: birim ? `${blok.eksen.y.ad} (${birim})` : blok.eksen.y.ad,
    nameLocation: "end",
    nameGap: 10,
    nameTextStyle: { color: tema.ikincil, align: "left" },
    axisLabel: { color: tema.ikincil, formatter: (v: number) => upTo3Text(v) },
    splitLine: { lineStyle: { color: tema.izgara } },
    ...ek,
  };
}

function kategoriEkseni(blok: GrafikBlok, tema: GrafikTema, ek: GrafikSecenek = {}): GrafikSecenek {
  return {
    type: "category",
    data: blok.kategoriler.map((k) => kategoriEtiketi(k, blok.eksen.x.tur)),
    // Az kategoride her ad basılır (uzun ad iki satıra kırılır); çokta çakışan gizlenir.
    axisLabel: {
      color: tema.ikincil,
      hideOverlap: true,
      ...(blok.eksen.x.tur === "kategori" && blok.kategoriler.length <= 12 ? { interval: 0, width: 96, overflow: "break" } : {}),
    },
    axisLine: { lineStyle: { color: tema.ikincil } },
    axisTick: { alignWithLabel: true },
    ...ek,
  };
}

function ipucu(blok: GrafikBlok, baski: boolean, tetik: "axis" | "item"): GrafikSecenek | undefined {
  if (baski) return undefined;
  return { trigger: tetik, valueFormatter: (v: unknown) => valueText(v, blok.eksen.y.birim) };
}

const izgara = (lejantVar: boolean): GrafikSecenek => ({ left: 12, right: 24, top: lejantVar ? 44 : 30, bottom: 12 });

function cizgiVeyaCubuk(blok: GrafikBlok, tema: GrafikTema, baski: boolean): GrafikSecenek {
  const cizgi = blok.tur === "cizgi";
  const lj = lejant(blok, tema);
  return {
    ...ortak(tema, baski),
    legend: lj,
    tooltip: ipucu(blok, baski, "axis"),
    grid: izgara(!!lj),
    xAxis: kategoriEkseni(blok, tema, cizgi ? { boundaryGap: false } : {}),
    yAxis: valueAxis(blok, tema),
    series: blok.seriler.map((s) =>
      cizgi
        ? {
            type: "line",
            name: s.ad,
            data: s.veri,
            connectNulls: false,
            showSymbol: blok.kategoriler.length <= 31,
            symbolSize: 5,
            z: s.soluk ? 1 : 2,
            lineStyle: { width: s.soluk ? 1.5 : 2.2, type: s.soluk ? "dashed" : "solid", opacity: s.soluk ? 0.7 : 1 },
            ...(s.soluk ? { color: tema.soluk } : {}),
          }
        : {
            type: "bar",
            name: s.ad,
            data: s.veri,
            barMaxWidth: 36,
            ...(blok.tur === "yiginCubuk" ? { stack: "toplam" } : {}),
            ...(s.soluk ? { color: tema.soluk, itemStyle: { opacity: 0.6 } } : {}),
          },
    ),
  };
}

function pasta(blok: GrafikBlok, tema: GrafikTema, baski: boolean): GrafikSecenek {
  const s = blok.seriler[0];
  const data = blok.kategoriler
    .map((k, i) => ({ name: kategoriEtiketi(k, blok.eksen.x.tur), value: s?.veri[i] }))
    .filter((d) => sonlu(d.value) && d.value > 0);
  return {
    ...ortak(tema, baski),
    tooltip: baski ? undefined : { trigger: "item", valueFormatter: (v: unknown) => valueText(v, blok.eksen.y.birim) },
    series: [
      {
        type: "pie",
        name: s?.ad ?? blok.eksen.y.ad,
        radius: ["36%", "66%"],
        center: ["50%", "52%"],
        avoidLabelOverlap: true,
        data,
        label: {
          color: tema.metin,
          formatter: (p: { name: string; percent: number }) => `${p.name}: %${reportCellText(p.percent, "0.0")}`,
        },
        labelLine: { lineStyle: { color: tema.ikincil } },
      },
    ],
  };
}

function isiHaritasi(blok: GrafikBlok, tema: GrafikTema, baski: boolean): GrafikSecenek {
  const data: [number, number, number][] = [];
  blok.seriler.forEach((s, yi) => s.veri.forEach((v, xi) => (sonlu(v) ? data.push([xi, yi, v]) : undefined)));
  const values = data.map((d) => d[2]);
  return {
    ...ortak(tema, baski),
    tooltip: baski
      ? undefined
      : { trigger: "item", formatter: (p: { value: [number, number, number] }) => valueText(p.value[2], blok.eksen.y.birim) },
    grid: { left: 12, right: 24, top: 16, bottom: 56 },
    xAxis: kategoriEkseni(blok, tema, { splitArea: { show: false } }),
    yAxis: {
      type: "category",
      inverse: true,
      data: blok.seriler.map((s) => s.ad),
      axisLabel: { color: tema.ikincil },
      // Boş hücre zeminde kalır; varsayılan gri şerit koyu temada beyaz bant olurdu.
      splitArea: { show: false },
    },
    visualMap: {
      min: Math.min(...values),
      max: Math.max(...values),
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 120,
      text: [upTo3Text(Math.max(...values)), upTo3Text(Math.min(...values))],
      inRange: { color: [tema.isiDusuk, tema.isiYuksek] },
      formatter: (v: number) => upTo3Text(v),
      textStyle: { color: tema.ikincil },
    },
    series: [
      {
        type: "heatmap",
        name: blok.eksen.y.ad,
        data,
        label: {
          show: data.length <= 120,
          // Hücre skalası temadan bağımsız açık→koyu; yazı koyu + beyaz hale her iki temada okunur.
          color: "#1f2937",
          textBorderColor: "#ffffff",
          textBorderWidth: 2,
          formatter: (p: { value: [number, number, number] }) => upTo3Text(p.value[2]),
        },
      },
    ],
  };
}

function sacilim(blok: GrafikBlok, tema: GrafikTema, baski: boolean, egilim?: Egilim | null): GrafikSecenek {
  const xs = blok.kategoriler.map((k) => Number(k.replace(",", ".")));
  const sayisal = xs.every(sonlu);
  const lj = lejant(blok, tema);
  return {
    ...ortak(tema, baski),
    legend: lj,
    tooltip: baski ? undefined : { trigger: "item", valueFormatter: (v: unknown) => valueText(v, blok.eksen.y.birim) },
    grid: izgara(!!lj),
    xAxis: sayisal
      ? {
          type: "value",
          name: blok.eksen.x.ad,
          nameLocation: "middle",
          nameGap: 24,
          nameTextStyle: { color: tema.ikincil },
          scale: true,
          axisLabel: { color: tema.ikincil, formatter: (v: number) => upTo3Text(v) },
          splitLine: { lineStyle: { color: tema.izgara } },
        }
      : kategoriEkseni(blok, tema),
    yAxis: valueAxis(blok, tema, { scale: true }),
    series: blok.seriler.map((s) => ({
      type: "scatter",
      name: s.ad,
      symbolSize: 8,
      itemStyle: { opacity: 0.8 },
      ...(s.soluk ? { color: tema.soluk } : {}),
      data: s.veri.flatMap((y, j) => (sonlu(y) ? [[sayisal ? xs[j]! : j, y]] : [])),
    })).concat(
      // Eğilim çizgisinin iki ucu sunucudan (R3-ANALIZ); istemci eğim hesaplamaz.
      egilim && sayisal ? [{ type: "line", name: "Eğilim", data: egilim, showSymbol: false, lineStyle: { type: "dashed", color: tema.ikincil }, tooltip: { show: false } } as never] : [],
    ),
  };
}

function kutu(blok: GrafikBlok, tema: GrafikTema, baski: boolean): GrafikSecenek {
  const ist = blok.seriler.map((s) => kutuIstatistigi(s.veri));
  const birim = blok.eksen.y.birim;
  const etiketler = ["En küçük", "Alt çeyrek", "Orta değer", "Üst çeyrek", "En büyük"];
  return {
    ...ortak(tema, baski),
    tooltip: baski
      ? undefined
      : {
          trigger: "item",
          formatter: (p: { name: string; seriesType: string; data: number[] }) =>
            p.seriesType === "boxplot"
              ? [p.name, ...etiketler.map((e, i) => `${e}: ${valueText(p.data.slice(-5)[i], birim)}`)].join("<br/>")
              : `${p.name}: ${valueText(p.data[1], birim)}`,
        },
    grid: izgara(false),
    xAxis: {
      type: "category",
      data: blok.seriler.map((s) => s.ad),
      axisLabel: { color: tema.ikincil, hideOverlap: true },
      axisLine: { lineStyle: { color: tema.ikincil } },
    },
    yAxis: valueAxis(blok, tema, { scale: true }),
    series: [
      {
        type: "boxplot",
        name: blok.eksen.y.ad,
        data: ist.map((k) => (k ? k.kutu : [])),
        itemStyle: { color: tema.isiDusuk, borderColor: tema.renkler[0], borderWidth: 1.5 },
      },
      {
        type: "scatter",
        name: "Aykırı",
        symbolSize: 6,
        color: tema.renkler[3] ?? tema.renkler[0],
        data: ist.flatMap((k, i) => (k ? k.aykirilar.map((v) => [i, v]) : [])),
      },
    ],
  };
}

function kucukCoklu(blok: GrafikBlok, tema: GrafikTema, baski: boolean): GrafikSecenek {
  const n = blok.seriler.length;
  const kolon = Math.min(3, n);
  const satir = Math.ceil(n / kolon);
  const tum = blok.seriler.flatMap((s) => s.veri.filter(sonlu));
  // Ortak eksen: küçük çoklular yalnız AYNI ölçekte kıyaslanabilir.
  const ust = niceCeiling(Math.max(...tum));
  const alt = -niceCeiling(-Math.min(0, ...tum));
  const w = 100 / kolon;
  const h = 100 / satir;
  const kutu = (i: number) => ({ c: i % kolon, r: Math.floor(i / kolon) });
  return {
    ...ortak(tema, baski),
    tooltip: ipucu(blok, baski, "axis"),
    title: blok.seriler.map((s, i) => ({
      text: s.ad,
      left: `${kutu(i).c * w + 2}%`,
      top: `${kutu(i).r * h + 1}%`,
      textStyle: { fontSize: 11, fontWeight: 600, color: tema.metin },
    })),
    grid: blok.seriler.map((_, i) => ({
      left: `${kutu(i).c * w + 3}%`,
      width: `${w - 9}%`,
      top: `${kutu(i).r * h + h * 0.2}%`,
      height: `${h * 0.62}%`,
    })),
    xAxis: blok.seriler.map((_, i) => kategoriEkseni(blok, tema, { gridIndex: i, boundaryGap: false, axisLabel: { color: tema.ikincil, hideOverlap: true, fontSize: 9, alignMinLabel: "left", alignMaxLabel: "right" } })),
    yAxis: blok.seriler.map((_, i) =>
      valueAxis(blok, tema, { gridIndex: i, name: "", min: alt, max: ust, splitNumber: 2, axisLabel: { color: tema.ikincil, fontSize: 9, formatter: (v: number) => upTo3Text(v) } }),
    ),
    series: blok.seriler.map((s, i) => ({
      type: "line",
      name: s.ad,
      xAxisIndex: i,
      yAxisIndex: i,
      data: s.veri,
      showSymbol: false,
      color: s.soluk ? tema.soluk : tema.renkler[0],
      lineStyle: { width: 1.8, type: s.soluk ? "dashed" : "solid" },
      areaStyle: { opacity: 0.08 },
    })),
  };
}

function bosSecenek(tema: GrafikTema, baski: boolean): GrafikSecenek {
  return {
    ...ortak(tema, baski),
    title: { text: GRAFIK_VERI_YOK, left: "center", top: "middle", textStyle: { color: tema.ikincil, fontSize: 13, fontWeight: 400 } },
  };
}

/** GrafikBlok → ECharts seçeneği. `baski`: tooltip ve animasyon kapalı (SVG/PDF). */
export function grafikSecenek(blok: GrafikBlok, tema: GrafikTema, opts: { baski?: boolean; egilim?: Egilim | null } = {}): GrafikSecenek {
  const baski = opts.baski === true;
  if (grafikBosMu(blok)) return bosSecenek(tema, baski);
  switch (blok.tur) {
    case "cizgi":
    case "cubuk":
    case "yiginCubuk":
      return cizgiVeyaCubuk(blok, tema, baski);
    case "pasta":
      return pasta(blok, tema, baski);
    case "isiHaritasi":
      return isiHaritasi(blok, tema, baski);
    case "sacilim":
      return sacilim(blok, tema, baski, opts.egilim);
    case "kutu":
      return kutu(blok, tema, baski);
    case "kucukCoklu":
      return kucukCoklu(blok, tema, baski);
  }
}
