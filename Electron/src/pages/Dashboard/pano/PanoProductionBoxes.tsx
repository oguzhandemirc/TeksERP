// Yeni kutular (üretim + müşteri): en çok müşteri, istasyon bazında üretim, açık iş emirleri, kalite özeti.
import { useState } from "react";
import { ChevronRight, ShieldCheck, Users, Workflow } from "lucide-react";
import { TERIM } from "@/lib/terim";
import { cn } from "@/lib/utils";
import { formatDisplay, formatPercent } from "@/lib/format";
import { upperTr } from "@/lib/tr-case";
import type { OpenWorkOrdersBox, QualityBox, StationOutputBox, TopCustomersBox } from "./box-types";
import { formatCount, metre } from "./pano-bicim";
import { BOX_TARGETS } from "./pano-hedefler";
import { PanoCard } from "./PanoBoxFrame";
import { PanoEmptyState } from "./PanoEmptyState";
import { BoxTabs, CHART_BG, CHART_STROKE, LegendDot, Ring, RowLink, useGo } from "./pano-ui";
import type { PanoErisim } from "./usePanoErisim";

const AVATAR_TONES = ["tile-violet", "tile-blue", "tile-teal", "tile-rose", "tile-amber"] as const;

/** Ad baş harfleri ("Boyer Tekstil" → "BT"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return upperTr(parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? "?").slice(0, 2));
}

/** En çok müşteri — sipariş / sevk sekmesi, avatar harfli liste. */
export function PanoTopCustomers({ d, erisim }: { d: TopCustomersBox; erisim: PanoErisim }) {
  const go = useGo(erisim);
  const tabs = [...(d.siparis ? [{ key: "siparis", label: "Sipariş" }] : []), ...(d.sevk ? [{ key: "sevk", label: "Sevk" }] : [])];
  const [tab, setTab] = useState(tabs[0]?.key ?? "siparis");
  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;
  const rows = active === "sevk"
    ? (d.sevk ?? []).map((r) => ({ id: r.musteriId, ad: r.ad, metre: r.metre, ek: null as string | null }))
    : (d.siparis ?? []).map((r) => ({ id: r.musteriId, ad: r.ad, metre: r.metre, ek: `${formatCount(r.siparisAdet)} sipariş` }));
  const target = active === "sevk" ? BOX_TARGETS.musteriSevk : BOX_TARGETS.musteriSiparis;
  return (
    <PanoCard title="En çok müşteri" action={<BoxTabs items={tabs} active={active ?? ""} onChange={setTab} label="Müşteri sıralaması" />}>
      {rows.length === 0 ? <PanoEmptyState icon={Users} metin="Bu dönemde kayıt yok" /> : (
        <div className="-mx-2 divide-y divide-border/60">
          {rows.map((r, i) => (
            <RowLink key={r.id} onClick={go(target)}>
              <span className={cn("tone-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", AVATAR_TONES[i % AVATAR_TONES.length])} aria-hidden>{initialsOf(r.ad)}</span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate font-medium" title={r.ad}>{r.ad || "—"}</span>
                {r.ek && <span className="text-xs text-muted-foreground">{r.ek}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{metre(r.metre)}</span>
            </RowLink>
          ))}
        </div>
      )}
    </PanoCard>
  );
}

/** İstasyon bazında üretim — yatay çubuklar (en büyük = tam). */
export function PanoStationOutput({ d, erisim }: { d: StationOutputBox; erisim: PanoErisim }) {
  const go = useGo(erisim)(BOX_TARGETS.istasyonUretim);
  const max = Math.max(1, ...d.istasyonlar.map((s) => s.metre));
  return (
    <PanoCard title="İstasyon bazında üretim" description={`Toplam ${metre(d.toplam.metre)} · ${formatCount(d.toplam.top)} top`}>
      {d.istasyonlar.length === 0 ? <PanoEmptyState icon={Workflow} metin="Bu dönemde istasyondan geçen top yok" /> : (
        <ul className="space-y-1">
          {d.istasyonlar.slice(0, 8).map((s, i) => (
            <li key={s.istasyonId}>
              <RowLink onClick={go} className="flex-col items-stretch gap-1 py-1.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium" title={s.ad}>{s.ad}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{metre(s.metre)}</span> · {formatCount(s.top)} top</span>
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", CHART_BG[i % CHART_BG.length])} style={{ width: `${Math.max(2, (s.metre / max) * 100)}%` }} />
                </span>
              </RowLink>
            </li>
          ))}
        </ul>
      )}
    </PanoCard>
  );
}

const WO_LABEL: Record<OpenWorkOrdersBox["durumlar"][number]["durum"], string> = { PLANNED: "Planlı", IN_PROGRESS: "Üretimde" };

/** Açık iş emirleri — segmentli küçük halka + durum satırları. */
export function PanoOpenWorkOrders({ d, erisim }: { d: OpenWorkOrdersBox; erisim: PanoErisim }) {
  const go = useGo(erisim)(BOX_TARGETS.isEmri);
  return (
    <PanoCard title={`Açık ${TERIM.terbiyeIsEmri.cogulKucuk}`}>
      <div className="@container">
      <div className="flex flex-col items-center gap-3 @[17rem]:flex-row @[17rem]:gap-4">
        <Ring size={96} thickness={11} label={`${formatCount(d.toplam)} açık ${TERIM.terbiyeIsEmri.tekilKucuk}`} parts={d.durumlar.map((s, i) => ({ value: s.adet, stroke: CHART_STROKE[i]! }))}>
          <span className="text-xl font-bold tabular-nums">{formatCount(d.toplam)}</span>
          <span className="text-[10px] text-muted-foreground">açık</span>
        </Ring>
        <div className="-mx-2 w-full min-w-0 flex-1">
          {d.durumlar.map((s, i) => (
            <RowLink key={s.durum} onClick={go}>
              <LegendDot color={CHART_BG[i]!} className="flex-1 text-muted-foreground">{WO_LABEL[s.durum] ?? s.durum}</LegendDot>
              <span className="font-semibold tabular-nums">{formatCount(s.adet)}</span>
              {go && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            </RowLink>
          ))}
        </div>
      </div>
      </div>
    </PanoCard>
  );
}

const pct = (n: number | null): string => formatPercent(n);

/** Kalite özeti — 1. kalite payı halkası, kalite kırılımı ve fire satırı. */
export function PanoQuality({ d, erisim }: { d: QualityBox; erisim: PanoErisim }) {
  const go = useGo(erisim);
  if (d.bitenMetre <= 0) {
    return <PanoCard title="Kalite özeti"><PanoEmptyState icon={ShieldCheck} metin="Bu dönemde biten kumaş yok" /></PanoCard>;
  }
  const top = d.birinciKalite;
  return (
    <PanoCard title="Kalite özeti" description={`${metre(d.bitenMetre)} · ${formatCount(d.bitenTop)} top`}>
      <div className="@container">
        <div className="flex flex-col items-center gap-4 @[22rem]:flex-row">
          <Ring label={top ? `${top.ad} payı ${pct(top.yuzde)}` : "Kalite payı yok"} parts={d.kaliteler.map((g, i) => ({ value: g.metre, stroke: CHART_STROKE[i % CHART_STROKE.length]! }))}>
            <span className="text-xl font-bold tabular-nums">{top ? pct(top.yuzde) : "—"}</span>
            <span className="max-w-[5rem] truncate text-[10px] text-muted-foreground">{top?.ad ?? "kalite"}</span>
          </Ring>
          <ul className="w-full min-w-0 space-y-1.5 text-xs">
            {d.kaliteler.slice(0, 5).map((g, i) => (
              <li key={g.kaliteId} className="flex items-center gap-2">
                <LegendDot color={CHART_BG[i % CHART_BG.length]!} className="flex-1">{g.ad}</LegendDot>
                <span className="tabular-nums text-muted-foreground">{metre(g.metre)}</span>
                <span className="w-11 text-right font-semibold tabular-nums">{pct(g.yuzde)}</span>
              </li>
            ))}
            {d.kalitesizMetre > 0 && <li className="flex justify-between text-muted-foreground"><span>Kalitesi girilmemiş</span><span className="tabular-nums">{metre(d.kalitesizMetre)}</span></li>}
          </ul>
        </div>
      </div>
      <div className="-mx-2 mt-3 border-t border-border/60 pt-1">
        <RowLink onClick={go(BOX_TARGETS.fire)}>
          <span className="flex-1 text-muted-foreground">Fire (hurda)</span>
          <span className="flex flex-col items-end leading-tight">
            <span className={cn("font-semibold tabular-nums", (d.fire.hurdaYuzde ?? 0) > 0 && "text-warning")}>{metre(d.fire.hurdaMetre)} · {pct(d.fire.hurdaYuzde)}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{formatCount(d.fire.tespitEdilenHata)} hata{d.fire.binMetredeHata !== null ? ` · ${formatDisplay(d.fire.binMetredeHata, 1)}/1.000 m` : ""}</span>
          </span>
        </RowLink>
      </div>
    </PanoCard>
  );
}
