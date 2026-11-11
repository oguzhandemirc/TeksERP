import { useCallback } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import type { GrafikTema } from "@/pages/Reports/_v2/grafik/tema";
import { PanoGrafik, saydam } from "./PanoGrafik";
import { kovaEtiketi, metre } from "./pano-bicim";
import { formatNumber } from "@/lib/format";
import type { PanoSummary } from "./types";

const BOS = <p className="py-10 text-center text-sm text-muted-foreground">Bu dönemde kayıt yok.</p>;

/** Üretim & sevk eğilimi (alan grafiği). İki seri de kapalıysa (izin/modül) kutu HİÇ çizilmez. */
export function PanoEgilim({ egilim }: { egilim: PanoSummary["egilim"] }) {
  const uretimVar = egilim.noktalar.some((n) => n.uretimMetre !== null);
  const sevkVar = egilim.noktalar.some((n) => n.sevkMetre !== null);
  const secenek = useCallback(
    (t: GrafikTema) => {
      const seri = (ad: string, renk: string, veri: Array<number | null>) => ({
        name: ad,
        type: "line",
        smooth: true,
        showSymbol: false,
        data: veri,
        lineStyle: { width: 2.5, color: renk },
        itemStyle: { color: renk },
        areaStyle: {
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: saydam(renk, 0.32) }, { offset: 1, color: saydam(renk, 0) }] },
        },
      });
      const series = [
        ...(uretimVar ? [seri("Üretim", t.renkler[0]!, egilim.noktalar.map((n) => n.uretimMetre))] : []),
        ...(sevkVar ? [seri("Sevk", t.renkler[1] ?? t.renkler[0]!, egilim.noktalar.map((n) => n.sevkMetre))] : []),
      ];
      return {
        animation: true,
        textStyle: { fontFamily: t.yaziTipi, color: t.metin, fontSize: 11 },
        grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
        legend: { top: 0, right: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: t.ikincil } },
        tooltip: { trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? metre(v) : "—") },
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
          axisLabel: { color: t.ikincil, formatter: (v: number) => formatNumber(v, 0) },
          splitLine: { lineStyle: { color: t.izgara, type: "dashed" } },
        },
        series,
      };
    },
    [egilim, uretimVar, sevkVar],
  );
  if (!uretimVar && !sevkVar) return null;
  const bos = egilim.noktalar.every((n) => !n.uretimMetre && !n.sevkMetre);
  return (
    <SectionCard title="Üretim ve sevk" description="Metre, dönem içinde">
      {bos ? BOS : <PanoGrafik secenek={secenek} yukseklik={240} etiket="Üretim ve sevk eğilimi" />}
    </SectionCard>
  );
}

/** Lejant noktası — grafikle aynı belirteç (`--chart-N`); 6'dan sonrası başa döner. */
const NOKTA = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"];

/** Üretilen kumaş dağılımı (halka) + lejant. */
export function PanoDagilim({ dagilim }: { dagilim: NonNullable<PanoSummary["dagilim"]> }) {
  const total = dagilim.dilimler.reduce((s, d) => s + d.metre, 0);
  const secenek = useCallback(
    (t: GrafikTema) => ({
      animation: true,
      color: t.renkler,
      textStyle: { fontFamily: t.yaziTipi, color: t.metin },
      tooltip: { trigger: "item", valueFormatter: (v: unknown) => (typeof v === "number" ? metre(v) : "—") },
      title: {
        text: formatNumber(total, 0),
        subtext: "metre",
        left: "center",
        top: "38%",
        textStyle: { color: t.metin, fontSize: 18, fontWeight: 700 },
        subtextStyle: { color: t.ikincil, fontSize: 11 },
      },
      series: [{
        type: "pie",
        radius: ["58%", "82%"],
        padAngle: 2,
        itemStyle: { borderRadius: 4 },
        label: { show: false },
        data: dagilim.dilimler.map((d) => ({ name: d.ad, value: d.metre })),
      }],
    }),
    [dagilim, total],
  );
  return (
    <SectionCard title="Üretilen kumaşlar" description="Dönemde biten metre">
      {dagilim.dilimler.length === 0 ? BOS : (
        <div className="flex flex-col items-center gap-3 sm:flex-row min-[1101px]:flex-col 2xl:flex-row">
          <div className="w-44 shrink-0"><PanoGrafik secenek={secenek} yukseklik={176} etiket="Üretilen kumaş dağılımı" /></div>
          <ul className="w-full min-w-0 space-y-1.5 text-xs">
            {dagilim.dilimler.map((d, i) => (
              <li key={d.itemId ?? d.ad} className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", NOKTA[i % NOKTA.length])} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={d.ad}>{d.ad}</span>
                <span className="tabular-nums text-muted-foreground">{metre(d.metre)} · %{formatNumber(d.yuzde, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
