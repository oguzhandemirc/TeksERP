import { useNavigate } from "react-router-dom";
import { Boxes, ClipboardList, Factory, Truck, Building2 } from "lucide-react";
import { BossSection, BossStat, BossBars } from "./BossSection";
import type {
  BossOrders,
  BossProduction,
  BossShipping,
  BossStock,
  BossSubcontract,
} from "@/services/bossService";

/** Metrajı kısa ve okunur bas — telefonda "31.971,1 m" satırı taşırıyor. */
function m(n: number): string {
  if (n >= 1000) return `${(n / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} bin m`;
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} m`;
}
const pct = (n: number) => `%${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;

export function StokCard({ data }: { data: BossStock }) {
  const nav = useNavigate();
  return (
    <BossSection
      title="Stok"
      icon={Boxes}
      onDrill={() => nav("/operations/rolls")}
      drillLabel="Envanter"
    >
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BossStat label="Ham stok" value={m(data.rawQty)} />
        <BossStat label="Yarı mamul" value={m(data.semiQty)} />
        <BossStat label="Bitmiş depo" value={m(data.finishedQty)} tone="ok" />
        <BossStat
          label={`Ölü stok (${data.deadStockDays}+ gün)`}
          value={m(data.deadQty)}
          tone={data.deadQty > 0 ? "warn" : "neutral"}
        />
      </div>
      <BossBars rows={data.topItems} unit="m" />
    </BossSection>
  );
}

export function SiparisCard({ data }: { data: BossOrders }) {
  const nav = useNavigate();
  return (
    <BossSection
      title="Açık siparişler"
      icon={ClipboardList}
      onDrill={() => nav("/reports/sales/open-order-coverage")}
      drillLabel="Karşılanma"
    >
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BossStat label="Açık kalem" value={String(data.openLineCount)} />
        <BossStat label="Açık metraj" value={m(data.openQty)} />
        <BossStat
          label="Karşılanma"
          value={pct(data.coveragePct)}
          tone={data.coveragePct >= 80 ? "ok" : data.coveragePct >= 50 ? "warn" : "bad"}
        />
        {/* ⚠️ EN ACİL UÇ ÖNE: termini geçmiş ve hâlâ karşılanamayan. Bu rakam
            sıfır değilse patronun bakması gereken tek yer burasıdır. */}
        <BossStat
          label="Geciken kalem"
          value={String(data.overdueLines)}
          tone={data.overdueLines > 0 ? "bad" : "ok"}
        />
      </div>
      <BossBars rows={data.topCustomers} unit="m" />
    </BossSection>
  );
}

export function UretimCard({ data }: { data: BossProduction }) {
  const nav = useNavigate();
  return (
    <BossSection
      title="Üretim akışı"
      icon={Factory}
      onDrill={() => nav("/operations/rolls?tab=KANBAN")}
      drillLabel="Pano"
    >
      {/* ⚠️ BİRİM ADET. Backend kolon başına yalnız sayım veriyor; burada metraja
          çevirmek aynı sorunun ikinci tanımını doğururdu (pano 48 / envanter 47). */}
      <div className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {data.columns.map((c) => (
          <BossStat key={c.key} label={c.label} value={`${c.count} top`} />
        ))}
      </div>
      {data.stations.length > 0 && (
        <div className="space-y-1 border-t pt-2.5">
          <p className="text-[11px] text-muted-foreground">İstasyon doluluğu</p>
          {data.stations.slice(0, 6).map((s) => (
            <div key={s.name} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {s.queueCount} bekliyor · {s.activeCount} işlemde · bugün {s.todayCompleted}
              </span>
            </div>
          ))}
        </div>
      )}
    </BossSection>
  );
}

export function SevkiyatCard({ data, meta }: { data: BossShipping; meta: string }) {
  const nav = useNavigate();
  return (
    <BossSection
      title="Sevkiyat"
      icon={Truck}
      meta={meta}
      onDrill={() => nav("/reports/sales/shipment-scorecard")}
      drillLabel="Karne"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BossStat label="Sevk edilen" value={m(data.shippedQty)} />
        <BossStat label="Top" value={String(data.shippedRollCount)} />
        <BossStat label="Kapanan sipariş" value={String(data.completedOrders)} />
        <BossStat
          label="Termine uyum"
          value={pct(data.onTimePct)}
          tone={data.onTimePct >= 90 ? "ok" : data.onTimePct >= 70 ? "warn" : "bad"}
        />
      </div>
      {data.avgLateDays !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Geç kapananlarda ortalama gecikme:{" "}
          <span className="font-medium text-foreground">
            {data.avgLateDays.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün
          </span>
        </p>
      )}
    </BossSection>
  );
}

export function FasonCard({ data, meta }: { data: BossSubcontract; meta: string }) {
  const nav = useNavigate();
  return (
    <BossSection
      title="Fasonda"
      icon={Building2}
      meta={meta}
      onDrill={() => nav("/reports/subcontract/scorecard")}
      drillLabel="Karne"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* "Dışarıda ne kadar mal var" — patronun bu bölümdeki asıl sorusu. */}
        <BossStat label="Dışarıda" value={m(data.openQty)} tone={data.openQty > 0 ? "warn" : "ok"} />
        <BossStat label="Açık kalem" value={String(data.openItems)} />
        <BossStat
          label="Çekme/fire"
          value={pct(data.firePct)}
          tone={data.firePct > 10 ? "bad" : data.firePct > 5 ? "warn" : "ok"}
        />
        <BossStat
          label="En eski açık"
          value={data.oldestOpenDays === null ? "—" : `${data.oldestOpenDays} gün`}
          tone={(data.oldestOpenDays ?? 0) > 30 ? "bad" : "neutral"}
        />
      </div>
      {data.avgTurnaroundDays !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Ortalama dönüş süresi:{" "}
          <span className="font-medium text-foreground">
            {data.avgTurnaroundDays.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün
          </span>
        </p>
      )}
    </BossSection>
  );
}
