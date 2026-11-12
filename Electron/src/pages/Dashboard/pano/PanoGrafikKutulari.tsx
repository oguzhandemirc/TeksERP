import { useMemo } from "react";
import { PanoCard } from "./PanoBoxFrame";
import { TrendAreaChart, type TrendSeries } from "@/components/insight/TrendAreaChart";
import { DonutBreakdown } from "@/components/insight/DonutBreakdown";
import { kovaEtiketi, metre } from "./pano-bicim";
import type { PanoSummary } from "./types";

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
export function PanoEgilim({ egilim: ham }: { egilim: PanoSummary["egilim"] }) {
  const egilim = useMemo(() => tamGunEkseni(ham), [ham]);
  const series = useMemo(() => egilimSerileri(egilim), [egilim]);
  const labels = useMemo(() => egilim.noktalar.map((n) => kovaEtiketi(n.anahtar, egilim.kova)), [egilim]);
  if (series.length === 0) return null;
  return (
    <PanoCard title="Üretim ve sevk" description="Metre, dönem içinde">
      <TrendAreaChart labels={labels} series={series} formatValue={metre} label="Üretim ve sevk eğilimi" emptyText="Bu dönemde üretim ve sevk yok" />
    </PanoCard>
  );
}

/** Üretilen kumaş dağılımı (halka) + lejant. */
export function PanoDagilim({ dagilim }: { dagilim: NonNullable<PanoSummary["dagilim"]> }) {
  const slices = useMemo(() => dagilim.dilimler.map((d) => ({ key: d.itemId ?? d.ad, name: d.ad, value: d.metre, percent: d.yuzde })), [dagilim]);
  return (
    <PanoCard title="Üretilen kumaşlar" description="Dönemde biten metre">
      <DonutBreakdown
        slices={slices}
        formatValue={metre}
        centerCaption="metre"
        label="Üretilen kumaş dağılımı"
        emptyText="Bu dönemde biten kumaş yok. Üretim kaydı geldikçe kumaş payları burada görünür."
      />
    </PanoCard>
  );
}
