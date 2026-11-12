import { Handshake } from "lucide-react";
import { BandStats } from "@/components/layout/ListPage";
import { formatDisplay } from "@/lib/format";
import type { RollStats } from "./service";

// Özet bandı ortak gösterim biçimi (binlik nokta, metre en çok 1 hane).
const NUM_FMT = { format: (n: number) => formatDisplay(n, 0) };
const DEC_FMT = { format: (n: number) => formatDisplay(n, 1) };

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
    <BandStats
      label="Stok özeti"
      scope={scopeLabel}
      items={[
        { key: "count", label: "Top", value: NUM_FMT.format(data.totalCount) },
        { key: "qty", label: "Metre", value: DEC_FMT.format(data.totalQty), unit: "m" },
      ]}
    >
      <ConsignedShare data={data} />
    </BandStats>
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
