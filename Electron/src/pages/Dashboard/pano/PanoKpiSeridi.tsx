import type { ReactNode } from "react";
import { Boxes, ClipboardList, Coins, Factory, Send, Truck, Wallet, type LucideIcon } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import type { IconTileTone } from "@/components/ui/icon-tile";
import { trendTone } from "@/components/ui/stat-card-compact";
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
      const ek = `Ham ${metre(k.hamMetre)}${k.iplikKg !== null ? ` · İplik ${kg(k.iplikKg)}` : ""}`;
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
  // Yüzde yokken de değişim satırı durur (kısa nötr metin): kartlar aynı yükseklikte kalır.
  // Anlık ölçüde (stok) değişim yok — ek bilgi o satıra iner, değer satırı kısa kalır.
  const bosKiyas = c.kpi ? (c.kpi.deger > 0 ? "Önceki dönemde yok" : "Değişim yok") : c.hint;
  const target = KPI_TARGETS[boxKey];
  return (
    <StatCard
      label={c.label}
      value={c.value}
      icon={c.icon}
      tone={c.tone}
      delta={rozet ? <span title={rozet.metin}><span className="font-semibold">{rozet.yuzde}</span> <span className="hidden font-normal text-muted-foreground @[13rem]:inline">{rozet.kiyas}</span></span> : <span data-kpi-bos-kiyas="" className="font-normal">{bosKiyas}</span>}
      trend={rozet?.trend ?? "neutral"}
      hint={c.kpi ? c.hint : undefined}
      layout="compact"
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
  const unpriced = "fiyatsizSatir" in data ? data.fiyatsizSatir : 0;
  const [first, ...rest] = data.tutarlar;
  const r = first ? degisimRozeti(first, donem) : null;
  // Birimler toplanmaz: ilk birim değer satırında, diğerleri değişim satırının altında kısa satır.
  return (
    <div className="@container h-full" data-testid={`pano-para-${boxKey}`}>
      <StatCard layout="compact" className="h-full" label={head.label} icon={head.icon} tone={head.tone} onClick={go}
        value={first ? <span title={para(first.deger, first.paraBirimi)}>{para(first.deger, first.paraBirimi)}</span> : <span className="text-sm font-normal text-muted-foreground">{head.empty}</span>}
        trend={r?.trend ?? "neutral"}
        delta={<>{r ? <span title={r.metin} className="font-semibold">{r.yuzde}</span> : null}
          {rest.map((t) => <MoneyLine key={t.paraBirimi} t={t} donem={donem} />)}
          {unpriced > 0 && <span className="ml-1 text-warning">{formatCount(unpriced)} fiyatsız</span>}</>} />
    </div>
  );
}

function MoneyLine({ t, donem }: { t: RevenueBox["tutarlar"][number]; donem: PanoDonem }) {
  const r = degisimRozeti(t, donem);
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-foreground" title={r?.metin}>
      <span className="tabular-nums">{para(t.deger, t.paraBirimi)}</span>
      {r && <span data-trend={r.trend} className={trendTone(r.trend)}>{r.yuzde}</span>}
    </span>
  );
}
