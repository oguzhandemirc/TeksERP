// Yeni kutular (akış): stok giriş–çıkış ve nakit giriş–çıkış — çift çubuk grafik; nakitte para birimi sekmesi.
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import type { GrafikTema } from "@/pages/Reports/_v2/grafik/tema";
import type { CashFlowBox, StockFlowBox } from "./box-types";
import { kg, kovaEtiketi, metre, para } from "./pano-bicim";
import { BOX_TARGETS } from "./pano-hedefler";
import { PanoCard } from "./PanoBoxFrame";
import { PanoGrafik } from "./PanoGrafik";
import { BoxTabs, RowLink, useGo } from "./pano-ui";
import type { PanoErisim } from "./usePanoErisim";
import type { PanoKova } from "./types";

/** Depo olayı → günlük dil (`WarehouseEventType`). */
export const STOCK_EVENT_LABEL: Record<string, string> = {
  ENTRY: "Depoya giriş", TRANSFER: "Transfer", TRANSFER_REVERSAL: "Transfer iptali", SHIPMENT: "Sevk", SHIPMENT_REVERSAL: "Sevk stornosu",
  RETURN: "Müşteri iadesi", CANCEL: "İptal / fire", CANCEL_REVERSAL: "İptal geri alma", PRODUCTION: "Üretim", EXTERNAL: "Fason / dış", ADJUST: "Düzeltme",
};

interface Series { name: string; data: number[]; color: (t: GrafikTema) => string }

/** Çift çubuk seçeneği — renk temadan (giriş = ana, çıkış = ikinci belirteç). */
function barOption(t: GrafikTema, labels: string[], series: Series[], fmt: (v: number) => string) {
  return {
    animation: true,
    textStyle: { fontFamily: t.yaziTipi, color: t.metin, fontSize: 11 },
    grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => (typeof v === "number" ? fmt(v) : "—") },
    xAxis: { type: "category", data: labels, axisLabel: { color: t.ikincil, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { color: t.ikincil, formatter: (v: number) => formatNumber(v, 0) }, splitLine: { lineStyle: { color: t.izgara, type: "dashed" } } },
    series: series.map((s) => ({ name: s.name, type: "bar", barMaxWidth: 12, barGap: "20%", data: s.data, itemStyle: { color: s.color(t), borderRadius: [4, 4, 0, 0] } })),
  };
}

const IN_COLOR = (t: GrafikTema) => t.renkler[0]!;
const OUT_COLOR = (t: GrafikTema) => t.renkler[2] ?? t.renkler[1] ?? t.renkler[0]!;

function Totals({ items }: { items: Array<{ label: string; value: string; dot: string }> }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("h-2 w-2 rounded-full", i.dot)} aria-hidden />{i.label}</p>
          <p className="truncate text-lg font-bold leading-tight tabular-nums">{i.value}</p>
        </div>
      ))}
    </div>
  );
}

const axisLabels = (points: Array<{ anahtar: string }>, kova: PanoKova) => points.map((n) => kovaEtiketi(n.anahtar, kova));

/** Stok giriş–çıkış — metre çubukları + olay türü kırılımı (+ iplik kg satırı). */
export function PanoStockFlow({ d, erisim }: { d: StockFlowBox; erisim: PanoErisim }) {
  const go = useGo(erisim)(BOX_TARGETS.stokHareket);
  const option = useCallback(
    (t: GrafikTema) => barOption(t, axisLabels(d.noktalar, d.kova), [
      { name: "Giriş", data: d.noktalar.map((n) => n.girisMetre), color: IN_COLOR },
      { name: "Çıkış", data: d.noktalar.map((n) => n.cikisMetre), color: OUT_COLOR },
    ], metre),
    [d],
  );
  return (
    <PanoCard title="Stok giriş–çıkış" description="Depoya giren ve çıkan metre">
      <div className="@container">
        <div className="flex flex-col gap-4 @[40rem]:flex-row">
          <div className="min-w-0 flex-1">
            <Totals items={[{ label: "Giriş", value: metre(d.toplam.girisMetre), dot: "bg-chart-1" }, { label: "Çıkış", value: metre(d.toplam.cikisMetre), dot: "bg-chart-3" }]} />
            <PanoGrafik secenek={option} yukseklik={190} etiket="Stok giriş ve çıkış grafiği" />
          </div>
          <div className="-mx-2 min-w-0 divide-y divide-border/60 @[40rem]:w-56">
            {d.turler.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">Bu dönemde depo hareketi yok</p>}
            {d.turler.slice(0, 6).map((r) => (
              <RowLink key={r.tur} onClick={go} className="py-1.5">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{STOCK_EVENT_LABEL[r.tur] ?? r.tur}</span>
                <span className="flex shrink-0 flex-col items-end text-xs leading-tight tabular-nums">
                  {r.girisMetre > 0 && <span className="font-semibold">+{metre(r.girisMetre)}</span>}
                  {r.cikisMetre > 0 && <span className="text-muted-foreground">−{metre(r.cikisMetre)}</span>}
                </span>
              </RowLink>
            ))}
            {d.iplik && (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className="text-muted-foreground">İplik</span>
                <span className="text-xs tabular-nums"><span className="font-semibold">+{kg(d.iplik.girisKg)}</span> · −{kg(d.iplik.cikisKg)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </PanoCard>
  );
}

/** Nakit giriş–çıkış — para birimi sekmesi; birimler TOPLANMAZ (her sekme kendi birimi). */
export function PanoCashFlow({ d, erisim }: { d: CashFlowBox; erisim: PanoErisim }) {
  const go = useGo(erisim)(BOX_TARGETS.nakit);
  const [cur, setCur] = useState(d.paraBirimleri[0]?.paraBirimi ?? "");
  const active = d.paraBirimleri.find((p) => p.paraBirimi === cur) ?? d.paraBirimleri[0];
  const option = useCallback(
    (t: GrafikTema) => barOption(t, active ? axisLabels(active.noktalar, d.kova) : [], active ? [
      { name: "Giriş", data: active.noktalar.map((n) => n.giris), color: IN_COLOR },
      { name: "Çıkış", data: active.noktalar.map((n) => n.cikis), color: OUT_COLOR },
    ] : [], (v) => para(v, active?.paraBirimi ?? "")),
    [active, d.kova],
  );
  const tabs = d.paraBirimleri.map((p) => ({ key: p.paraBirimi, label: p.paraBirimi }));
  return (
    <PanoCard title="Nakit giriş–çıkış" description="Kasa ve banka, transferler hariç"
      action={<BoxTabs items={tabs} active={active?.paraBirimi ?? ""} onChange={setCur} label="Para birimi" />}>
      {!active ? <p className="py-8 text-center text-sm text-muted-foreground">Bu dönemde kasa/banka hareketi yok</p> : (
        <>
          <button type="button" disabled={!go} onClick={go} className="block w-full text-left disabled:cursor-default">
            <Totals items={[
              { label: "Giriş", value: para(active.toplamGiris, active.paraBirimi), dot: "bg-chart-1" },
              { label: "Çıkış", value: para(active.toplamCikis, active.paraBirimi), dot: "bg-chart-3" },
              { label: "Net", value: para(active.toplamGiris - active.toplamCikis, active.paraBirimi), dot: "bg-muted-foreground/40" },
            ]} />
          </button>
          <PanoGrafik secenek={option} yukseklik={190} etiket={`${active.paraBirimi} nakit giriş ve çıkış grafiği`} />
        </>
      )}
    </PanoCard>
  );
}
