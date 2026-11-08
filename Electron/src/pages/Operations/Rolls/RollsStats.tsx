import { Handshake, Package, Ruler, type LucideIcon } from "lucide-react";
import type { RollStats } from "./service";

const NUM_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false });
const DEC_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/**
 * Envanter üst-satırı özeti: filtreye uyan TÜM topların adet + metre toplamı.
 * Sayı AKTİF SEKMEnin kapsamıdır (Ham Stok / Depo / Üretimde …) — `scopeLabel`
 * ile hangi kümenin sayıldığı açıkça yazılır (yoksa "hangi top?" belirsizliği).
 */
export function RollsStats({
  data,
  isLoading,
  scopeLabel,
}: {
  data: RollStats | undefined;
  isLoading: boolean;
  scopeLabel: string;
}) {
  if (isLoading && !data) {
    return <span className="text-xs text-muted-foreground">Yükleniyor…</span>;
  }
  if (!data) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-primary/25 bg-primary/5 px-3 py-1 shadow-sm">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
        {scopeLabel}
      </span>
      <Divider />
      <Stat icon={Package} value={NUM_FMT.format(data.totalCount)} unit="top" />
      <Divider />
      <Stat icon={Ruler} value={DEC_FMT.format(data.totalQty)} unit="m" />
      <ConsignedShare data={data} />
    </div>
  );
}

/**
 * "Bunun X m'si emanet" — toplamın müşteri malı kısmı (aynı where ∧ emanet; sunucu yalnız emanet açıkken yollar).
 * Emanet yoksa çizilmez; toplamın tamamı emanetse (Mülkiyet: Emanet) "tamamı emanet" der.
 */
export function ConsignedShare({ data }: { data: RollStats }) {
  const c = data.consigned;
  if (!c || c.count === 0) return null;
  const all = c.count === data.totalCount;
  return (
    <>
      <Divider />
      <span
        className="flex items-center gap-1 text-[11px] text-muted-foreground"
        title={`Bu toplamın ${NUM_FMT.format(c.count)} topu / ${DEC_FMT.format(c.qty)} m'si müşterinin malı (emanet); fabrikanın stoğu değildir.`}
        data-testid="rolls-stats-consigned"
      >
        <Handshake className="h-3.5 w-3.5 text-amber-600" />
        {all ? (
          <span>tamamı emanet</span>
        ) : (
          <span>
            bunun <b className="font-semibold text-foreground tabular-nums">{DEC_FMT.format(c.qty)}</b> m'si emanet
            <span className="tabular-nums"> ({NUM_FMT.format(c.count)} top)</span>
          </span>
        )}
      </span>
    </>
  );
}

function Stat({ icon: Icon, value, unit }: { icon: LucideIcon; value: string; unit: string }) {
  return (
    <div className="flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="text-sm font-bold text-foreground tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{unit}</span>
    </div>
  );
}

function Divider() {
  return <span className="h-3.5 w-px bg-primary/20" aria-hidden />;
}
