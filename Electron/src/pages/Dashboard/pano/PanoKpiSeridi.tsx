import type { ReactNode } from "react";
import { Boxes, ClipboardList, Factory, Send, Truck, type LucideIcon } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import type { IconTileTone } from "@/components/ui/icon-tile";
import { useTabsStore } from "@/store/tabs";
import { formatCount, degisimRozeti, kg, metre } from "./pano-bicim";
import { KPI_TARGETS } from "./pano-hedefler";
import type { PanoErisim } from "./usePanoErisim";
import type { PanoDonem, PanoKpi, PanoSummary } from "./types";

interface Kart {
  key: keyof typeof KPI_TARGETS;
  label: string;
  icon: LucideIcon;
  tone: IconTileTone;
  value: string;
  kpi: PanoKpi | null;
  hint: ReactNode;
}

/** Null kutu kart üretmez — boş kart yok. */
export function kpiKartlari(k: PanoSummary["kpi"]): Kart[] {
  const out: Kart[] = [];
  if (k.uretim) out.push({ key: "uretim", label: "Üretim", icon: Factory, tone: "violet", value: metre(k.uretim.metre.deger), kpi: k.uretim.metre, hint: `${formatCount(k.uretim.top.deger)} top` });
  if (k.sevk) out.push({ key: "sevk", label: "Sevk", icon: Truck, tone: "green", value: metre(k.sevk.metre.deger), kpi: k.sevk.metre, hint: `${formatCount(k.sevk.irsaliye.deger)} irsaliye` });
  if (k.siparis) out.push({ key: "siparis", label: "Yeni sipariş", icon: ClipboardList, tone: "blue", value: formatCount(k.siparis.adet.deger), kpi: k.siparis.adet, hint: metre(k.siparis.metre.deger) });
  if (k.fason) out.push({ key: "fason", label: "Fasona giden", icon: Send, tone: "orange", value: metre(k.fason.gidenMetre.deger), kpi: k.fason.gidenMetre, hint: `Dönen ${metre(k.fason.donenMetre)}` });
  if (k.stok) {
    // İki kısa satır: tek satırda "Ham … · İplik …" dar kartta kırpılıyordu.
    const ek = <>Ham {metre(k.stok.hamMetre)}{k.stok.iplikKg !== null && <><br />İplik {kg(k.stok.iplikKg)}</>}</>;
    out.push({ key: "stok", label: "Mamul stok", icon: Boxes, tone: "teal", value: metre(k.stok.mamulMetre), kpi: null, hint: ek });
  }
  return out;
}

export function PanoKpiSeridi({ kpi, donem, erisim, yukleniyor }: { kpi: PanoSummary["kpi"] | null; donem: PanoDonem; erisim: PanoErisim; yukleniyor: boolean }) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  if (yukleniyor) {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-4" data-testid="pano-kpi-iskelet">
        {Array.from({ length: 5 }, (_, i) => <StatCard key={i} label="…" value="" loading layout="stacked" />)}
      </div>
    );
  }
  const kartlar = kpi ? kpiKartlari(kpi) : [];
  if (kartlar.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-4">
      {kartlar.map((c) => {
        const rozet = degisimRozeti(c.kpi, donem);
        const target = KPI_TARGETS[c.key];
        return (
          <StatCard
            key={c.key}
            label={c.label}
            value={c.value}
            icon={c.icon}
            tone={c.tone}
            delta={rozet ? <span title={rozet.metin}><span className="font-semibold">{rozet.yuzde}</span> <span className="hidden font-normal text-muted-foreground @[11rem]:inline">{rozet.kiyas}</span></span> : undefined}
            trend={rozet?.trend ?? "neutral"}
            hint={c.hint}
            layout="stacked"
            className="@container"
            onClick={erisim.canGo(target) ? () => navigateActive(target.to) : undefined}
          />
        );
      })}
    </div>
  );
}
