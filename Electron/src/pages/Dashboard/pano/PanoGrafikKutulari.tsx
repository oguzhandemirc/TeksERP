import { useMemo } from "react";
import { PanoCard } from "./PanoBoxFrame";
import { TrendAreaChart, type TrendSeries } from "@/components/insight/TrendAreaChart";
import { DonutBreakdown } from "@/components/insight/DonutBreakdown";
import { kovaEtiketi, metre } from "./pano-bicim";
import { formatDisplay } from "@/lib/format";
import { SERIES_DOT } from "@/components/insight/chart-parts";
import { cn } from "@/lib/utils";
import { DEFAULT_BOX_OPTIONS, type DistributionOptions, type TrendOptions } from "./box-options";
import type { PanoSummary } from "./types";

const EMPTY_TEXT = "Bu dönemde biten kumaş yok. Üretim kaydı geldikçe kumaş payları burada görünür.";

/**
 * Saatlik kovada BÜTÜN GÜN ekseni (00–23): sunucu yalnız geçen saatleri yollar ("Bugün" gece 03'te 3 kova);
 * eksen kısalınca tek nokta eğimli alana dönüşüp yanıltıyordu. Gelmeyen saat `null` (çizilmez, 0 değil).
 */
export function tamGunEkseni(egilim: PanoSummary["egilim"]): PanoSummary["egilim"] {
  if (egilim.kova !== "saat") return egilim;
  const bySaat = new Map(egilim.noktalar.map((n) => [Number(n.anahtar), n]));
  const noktalar = Array.from({ length: 24 }, (_, h) => bySaat.get(h) ?? { anahtar: String(h).padStart(2, "0"), uretimMetre: null, sevkMetre: null });
  return { ...egilim, noktalar };
}

/** Eğilim serileri — kapalı (izin/modül, bütün kovaları null) seri düşer; renk sırası sabit (üretim 1, sevk 2). */
export function egilimSerileri(egilim: PanoSummary["egilim"]): TrendSeries[] {
  const out: TrendSeries[] = [];
  if (egilim.noktalar.some((n) => n.uretimMetre !== null)) out.push({ key: "uretim", name: "Üretim", colorIndex: 0, values: egilim.noktalar.map((n) => n.uretimMetre) });
  if (egilim.noktalar.some((n) => n.sevkMetre !== null)) out.push({ key: "sevk", name: "Sevk", colorIndex: 1, values: egilim.noktalar.map((n) => n.sevkMetre) });
  return out;
}

/** Üretim & sevk eğilimi (alan grafiği). İki seri de kapalıysa (izin/modül) kutu HİÇ çizilmez. */
export function PanoEgilim({ egilim: ham, options = DEFAULT_BOX_OPTIONS.egilim }: { egilim: PanoSummary["egilim"]; options?: TrendOptions }) {
  const egilim = useMemo(() => tamGunEkseni(ham), [ham]);
  const series = useMemo(() => {
    const all = egilimSerileri(egilim);
    const kept = all.filter((s) => !options.hidden.includes(s.key as "uretim" | "sevk"));
    return kept.length > 0 ? kept : all;
  }, [egilim, options.hidden]);
  const labels = useMemo(() => egilim.noktalar.map((n) => kovaEtiketi(n.anahtar, egilim.kova)), [egilim]);
  if (series.length === 0) return null;
  return (
    <PanoCard title="Üretim ve sevk" description="Metre, dönem içinde">
      <TrendAreaChart labels={labels} series={series} formatValue={metre} label="Üretim ve sevk eğilimi" emptyText="Bu dönemde üretim ve sevk yok" kind={options.chart} />
    </PanoCard>
  );
}

/** Üretilen kumaş dağılımı (halka ya da yatay çubuk) + lejant. Dilim sayısı yalnız lejantı/çubukları keser; halka
 *  bütün dilimleri çizer, yüzde sunucunun (istemci dilim birleştirmez). */
export function PanoDagilim({ dagilim, options = DEFAULT_BOX_OPTIONS.dagilim }: { dagilim: NonNullable<PanoSummary["dagilim"]>; options?: DistributionOptions }) {
  const slices = useMemo(() => dagilim.dilimler.map((d) => ({ key: d.itemId ?? d.ad, name: d.ad, value: d.metre, percent: d.yuzde })), [dagilim]);
  return (
    <PanoCard title="Üretilen kumaşlar" description="Dönemde biten metre">
      {options.chart === "bars" ? <SliceBars slices={slices.slice(0, options.slices)} /> : <DonutBreakdown
        legendLimit={options.slices}
        slices={slices}
        formatValue={metre}
        centerCaption="metre"
        label="Üretilen kumaş dağılımı"
        emptyText={EMPTY_TEXT}
      />}
    </PanoCard>
  );
}

/** Yatay çubuk: genişlik sunucunun yüzdesi (toplamın payı), renk sırası halkayla aynı. */
function SliceBars({ slices }: { slices: Array<{ key: string; name: string; value: number; percent: number }> }) {
  if (slices.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{EMPTY_TEXT}</p>;
  return (
    <ul className="space-y-2.5 text-xs" data-testid="dagilim-cubuk">
      {slices.map((d, i) => (
        <li key={d.key}>
          <div className="mb-1 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={d.name}>{d.name}</span>
            <span className="tabular-nums text-muted-foreground">{metre(d.value)}</span>
            <span className="w-9 text-right font-semibold tabular-nums">%{formatDisplay(d.percent, 0)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted"><div className={cn("h-full rounded-full", SERIES_DOT[i % SERIES_DOT.length])} style={{ width: `${Math.min(100, Math.max(0, d.percent))}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
