import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Boxes, ClipboardList, Coins, Factory, Send, Truck, Wallet, type LucideIcon } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";
import type { CollectionBox, PanoBoxData, RevenueBox } from "./box-types";
import { formatCount, degisimRozeti, kg, metre, para } from "./pano-bicim";
import { KPI_TARGETS } from "./pano-hedefler";
import type { PanoErisim } from "./usePanoErisim";
import type { PanoDonem, PanoKpi, PanoSummary } from "./types";

export type CountKpiKey = "uretim" | "sevk" | "siparis" | "fason" | "stok";
export type MoneyKpiKey = "ciro" | "tahsilat";

interface Kart {
  label: string;
  icon: LucideIcon;
  tone: IconTileTone;
  value: string;
  kpi: PanoKpi | null;
  hint: ReactNode;
}

/** Tek KPI kutusunun kart içeriği. */
export function kpiCardOf<K extends CountKpiKey>(key: K, d: PanoBoxData[K]): Kart {
  switch (key) {
    case "uretim": {
      const k = d as PanoBoxData["uretim"];
      return { label: "Üretim", icon: Factory, tone: "violet", value: metre(k.metre.deger), kpi: k.metre, hint: `${formatCount(k.top.deger)} top` };
    }
    case "sevk": {
      const k = d as PanoBoxData["sevk"];
      return { label: "Sevk", icon: Truck, tone: "green", value: metre(k.metre.deger), kpi: k.metre, hint: `${formatCount(k.irsaliye.deger)} irsaliye` };
    }
    case "siparis": {
      const k = d as PanoBoxData["siparis"];
      return { label: "Yeni sipariş", icon: ClipboardList, tone: "blue", value: formatCount(k.adet.deger), kpi: k.adet, hint: metre(k.metre.deger) };
    }
    case "fason": {
      const k = d as PanoBoxData["fason"];
      return { label: "Fasona giden", icon: Send, tone: "orange", value: metre(k.gidenMetre.deger), kpi: k.gidenMetre, hint: `Dönen ${metre(k.donenMetre)}` };
    }
    default: {
      const k = d as PanoBoxData["stok"];
      // İki kısa satır: tek satırda "Ham … · İplik …" dar kartta kırpılıyordu.
      const ek = <>Ham {metre(k.hamMetre)}{k.iplikKg !== null && <><br />İplik {kg(k.iplikKg)}</>}</>;
      return { label: "Mamul stok", icon: Boxes, tone: "teal", value: metre(k.mamulMetre), kpi: null, hint: ek };
    }
  }
}

const COUNT_KPI_KEYS: readonly CountKpiKey[] = ["uretim", "sevk", "siparis", "fason", "stok"];

/** Özet yanıtının KPI kartları (Rapor Merkezi "Öne çıkan sayılar") — null kutu kart üretmez. */
export function kpiKartlari(k: PanoSummary["kpi"]): Array<Kart & { key: CountKpiKey }> {
  return COUNT_KPI_KEYS.flatMap((key) => {
    const d = k[key];
    return d ? [{ key, ...kpiCardOf(key, d as PanoBoxData[typeof key]) }] : [];
  });
}

interface CardProps<K extends CountKpiKey> { boxKey: K; data: PanoBoxData[K]; donem: PanoDonem; erisim: PanoErisim }

export function PanoKpiCard<K extends CountKpiKey>({ boxKey, data, donem, erisim }: CardProps<K>) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const c = kpiCardOf(boxKey, data);
  const rozet = degisimRozeti(c.kpi, donem);
  // Yüzde yokken de değişim satırı durur: kartlar aynı iskelette kalır (0 değerli kart kısa/boş görünmesin).
  const bosKiyas = c.kpi ? (c.kpi.deger > 0 ? "Önceki dönemde yok" : "Değişim yok") : "Anlık durum";
  const target = KPI_TARGETS[boxKey];
  return (
    <StatCard
      label={c.label}
      value={c.value}
      icon={c.icon}
      tone={c.tone}
      delta={rozet ? <span title={rozet.metin}><span className="font-semibold">{rozet.yuzde}</span> <span className="hidden font-normal text-muted-foreground @[11rem]:inline">{rozet.kiyas}</span></span> : <span data-kpi-bos-kiyas="" className="font-normal">{bosKiyas}</span>}
      trend={rozet?.trend ?? "neutral"}
      hint={c.hint}
      layout="stacked"
      className="@container h-full"
      onClick={erisim.canGo(target) ? () => navigateActive(target.to) : undefined}
    />
  );
}

const MONEY_HEAD: Record<MoneyKpiKey, { label: string; icon: LucideIcon; tone: IconTileTone; empty: string }> = {
  ciro: { label: "Ciro", icon: Coins, tone: "amber", empty: "Bu dönemde sevk tutarı yok" },
  tahsilat: { label: "Tahsilat", icon: Wallet, tone: "sky", empty: "Bu dönemde tahsilat yok" },
};

/** Para KPI'ı — para birimi başına satır; birimler TOPLANMAZ. */
export function PanoMoneyKpi({ boxKey, data, donem, erisim }: { boxKey: MoneyKpiKey; data: RevenueBox | CollectionBox; donem: PanoDonem; erisim: PanoErisim }) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const head = MONEY_HEAD[boxKey];
  const target = KPI_TARGETS[boxKey];
  const go = erisim.canGo(target) ? () => navigateActive(target.to) : undefined;
  const Comp = go ? "button" : "div";
  const unpriced = "fiyatsizSatir" in data ? data.fiyatsizSatir : 0;
  return (
    <Comp type={go ? "button" : undefined} onClick={go} data-slot="card" data-testid={`pano-para-${boxKey}`}
      className={cn("@container flex h-full w-full min-w-0 flex-col rounded-xl border border-card-border bg-card p-4 text-left text-card-foreground shadow-card",
        go && "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      <div className="mb-2 flex items-center gap-2.5">
        <IconTile icon={head.icon} tone={head.tone} size="sm" />
        <p className="truncate text-sm font-semibold text-muted-foreground">{head.label}</p>
      </div>
      {data.tutarlar.length === 0 ? <p className="text-sm text-muted-foreground">{head.empty}</p> : (
        <ul className="space-y-1">
          {data.tutarlar.map((t, i) => {
            const r = degisimRozeti(t, donem);
            const Arrow = r?.trend === "up" ? ArrowUpRight : r?.trend === "down" ? ArrowDownRight : null;
            return (
              <li key={t.paraBirimi} className="flex min-w-0 items-baseline justify-between gap-2">
                <span className={cn("min-w-0 truncate font-bold tabular-nums", i === 0 ? "text-xl" : "text-sm")} title={para(t.deger, t.paraBirimi)}>{para(t.deger, t.paraBirimi)}</span>
                {r && (
                  <span data-trend={r.trend} title={r.metin}
                    className={cn("inline-flex shrink-0 items-center text-xs font-semibold", r.trend === "up" ? "text-success" : r.trend === "down" ? "text-destructive" : "text-muted-foreground")}>
                    {Arrow && <Arrow className="h-3.5 w-3.5" aria-hidden />}{r.yuzde}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {unpriced > 0 && <p className="mt-1 truncate text-xs text-warning">{formatCount(unpriced)} satır fiyatsız</p>}
    </Comp>
  );
}
