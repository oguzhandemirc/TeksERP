import { useCallback } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import type { GrafikTema } from "@/pages/Reports/_v2/grafik/tema";
import { PanoGrafik, saydam } from "./PanoGrafik";
import { kovaEtiketi, metre } from "./pano-bicim";
import { formatNumber } from "@/lib/format";
import type { PanoSummary } from "./types";

/** Boş grafiğin üstündeki kısa not — iskelet eksen/halka altta soluk kalır (büyük boşluk yerine). */
const EmptyNote = ({ metin }: { metin: string }) => (
  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
    <span className="rounded-full border border-card-border bg-card/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">{metin}</span>
  </div>
);

/** Üretim & sevk eğilimi (alan grafiği). İki seri de kapalıysa (izin/modül) kutu HİÇ çizilmez. */
export function PanoEgilim({ egilim }: { egilim: PanoSummary["egilim"] }) {
  const uretimVar = egilim.noktalar.some((n) => n.uretimMetre !== null);
  const sevkVar = egilim.noktalar.some((n) => n.sevkMetre !== null);
  const bos = egilim.noktalar.every((n) => !n.uretimMetre && !n.sevkMetre);
  const secenek = useCallback(
    (t: GrafikTema) => {
      // Boş dönem: aynı eksenler, soluk çizgi, sabit üst sınır — ECharts 0..1 eksenini göstermesin.
      const seri = (ad: string, renk0: string, veri: Array<number | null>) => {
        const renk = bos ? t.izgara : renk0;
        return {
        name: ad,
        type: "line",
        smooth: true,
        showSymbol: false,
        data: veri,
        lineStyle: { width: 2.5, color: renk },
        itemStyle: { color: renk },
        emphasis: { focus: "series" },
        areaStyle: {
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: saydam(renk, bos ? 0 : 0.38) }, { offset: 1, color: saydam(renk, 0.02) }] },
        },
      };
      };
      const series = [
        ...(uretimVar ? [seri("Üretim", t.renkler[0]!, egilim.noktalar.map((n) => n.uretimMetre))] : []),
        ...(sevkVar ? [seri("Sevk", t.renkler[1] ?? t.renkler[0]!, egilim.noktalar.map((n) => n.sevkMetre))] : []),
      ];
      return {
        animation: true,
        textStyle: { fontFamily: t.yaziTipi, color: t.metin, fontSize: 11 },
        grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
        tooltip: { show: !bos, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.ikincil, type: "dashed" } }, valueFormatter: (v: unknown) => (typeof v === "number" ? metre(v) : "—") },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: egilim.noktalar.map((n) => kovaEtiketi(n.anahtar, egilim.kova)),
          axisLabel: { color: t.ikincil, hideOverlap: true },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          ...(bos ? { min: 0, max: 1000, interval: 250 } : {}),
          axisLabel: { color: t.ikincil, formatter: (v: number) => formatNumber(v, 0) },
          splitLine: { lineStyle: { color: t.izgara, type: "dashed" } },
        },
        series,
      };
    },
    [egilim, uretimVar, sevkVar, bos],
  );
  if (!uretimVar && !sevkVar) return null;
  const sumOf = (f: (n: (typeof egilim.noktalar)[number]) => number | null) => egilim.noktalar.reduce((a, n) => a + (f(n) ?? 0), 0);
  return (
    <SectionCard title="Üretim ve sevk" description="Metre, dönem içinde">
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1">
        {uretimVar && <SeriesTotal renk="bg-chart-1" etiket="Üretim" deger={metre(sumOf((n) => n.uretimMetre))} />}
        {sevkVar && <SeriesTotal renk="bg-chart-2" etiket="Sevk" deger={metre(sumOf((n) => n.sevkMetre))} />}
      </div>
      <div className="relative">
        <PanoGrafik secenek={secenek} yukseklik={220} etiket="Üretim ve sevk eğilimi" />
        {bos && <EmptyNote metin="Bu dönemde üretim ve sevk yok" />}
      </div>
    </SectionCard>
  );
}

function SeriesTotal({ renk, etiket, deger }: { renk: string; etiket: string; deger: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("h-2 w-2 rounded-full", renk)} aria-hidden />{etiket}</p>
      <p className="text-xl font-bold leading-tight tabular-nums">{deger}</p>
    </div>
  );
}

/** Lejant noktası — grafikle aynı belirteç (`--chart-N`); 6'dan sonrası başa döner. */
const NOKTA = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"];

/** Üretilen kumaş dağılımı (halka) + lejant. */
export function PanoDagilim({ dagilim }: { dagilim: NonNullable<PanoSummary["dagilim"]> }) {
  const total = dagilim.dilimler.reduce((s, d) => s + d.metre, 0);
  const bos = dagilim.dilimler.length === 0;
  const secenek = useCallback(
    (t: GrafikTema) => ({
      animation: true,
      // Boşken tek soluk halka (ızgara rengi) — ortadaki 0 ile "iskelet" okunur.
      color: bos ? [t.izgara] : t.renkler,
      textStyle: { fontFamily: t.yaziTipi, color: t.metin },
      tooltip: { show: !bos, trigger: "item", valueFormatter: (v: unknown) => (typeof v === "number" ? metre(v) : "—") },
      title: {
        text: formatNumber(total, 0),
        subtext: "metre",
        left: "center",
        top: "38%",
        textStyle: { color: bos ? t.ikincil : t.metin, fontSize: 20, fontWeight: 700 },
        subtextStyle: { color: t.ikincil, fontSize: 11 },
      },
      series: [{
        type: "pie",
        radius: ["60%", "86%"],
        padAngle: bos ? 0 : 2,
        itemStyle: { borderRadius: 4 },
        label: { show: false },
        silent: bos,
        data: bos ? [{ name: "", value: 1 }] : dagilim.dilimler.map((d) => ({ name: d.ad, value: d.metre })),
      }],
    }),
    [dagilim, total, bos],
  );
  return (
    <SectionCard title="Üretilen kumaşlar" description="Dönemde biten metre">
      {/* Kartın kendi genişliği belirler (ekran değil): dar kartta halka üstte, lejant altında. */}
      <div className="@container">
      <div className="flex flex-col items-center gap-4 @[26rem]:flex-row">
        <div className="relative w-44 shrink-0"><PanoGrafik secenek={secenek} yukseklik={176} etiket="Üretilen kumaş dağılımı" /></div>
        {bos ? (
          <p className="w-full text-center text-xs text-muted-foreground @[26rem]:text-left">Bu dönemde biten kumaş yok. Üretim kaydı geldikçe kumaş payları burada görünür.</p>
        ) : (
          <ul className="w-full min-w-0 space-y-2 text-xs">
            {dagilim.dilimler.map((d, i) => (
              <li key={d.itemId ?? d.ad} className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", NOKTA[i % NOKTA.length])} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={d.ad}>{d.ad}</span>
                <span className="tabular-nums text-muted-foreground">{metre(d.metre)}</span>
                <span className="w-9 text-right font-semibold tabular-nums">%{formatNumber(d.yuzde, 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </SectionCard>
  );
}
