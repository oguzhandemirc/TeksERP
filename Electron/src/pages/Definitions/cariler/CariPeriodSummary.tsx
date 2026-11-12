// Cari dönem özeti — `GET /api/customers/:id/period-summary` (panonun kaynakları, müşteri süzgeçli). İstemci hesap
// yapmaz: değer, önceki dönem ve değişim % sunucudan; `null` ölçü (izin/modül yok) kart çizmez; para birimleri ayrı.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Coins, Truck } from "lucide-react";
import apiClient from "@/services/apiClient";
import { StatCard } from "@/components/ui/stat-card";
import { DonemSecici } from "@/pages/Dashboard/pano/PanoYerlesim";
import { degisimRozeti, formatCount, metre, para } from "@/pages/Dashboard/pano/pano-bicim";
import type { PanoDonem, PanoKpi } from "@/pages/Dashboard/pano/types";
import type { PanoMoneyKpi } from "@/pages/Dashboard/pano/box-types";

export interface CustomerPeriodSummary {
  donem: PanoDonem;
  aralik: { baslangic: string; bitis: string };
  sevk: { metre: PanoKpi; irsaliye: PanoKpi } | null;
  ciro: { tutarlar: PanoMoneyKpi[]; fiyatsizSatir: number } | null;
  siparis: { adet: PanoKpi; metre: PanoKpi } | null;
}

export async function fetchPeriodSummary(customerId: string, donem: PanoDonem): Promise<CustomerPeriodSummary> {
  const res = await apiClient.get<{ data: CustomerPeriodSummary }>(`/api/customers/${customerId}/period-summary`, { params: { donem } });
  return res.data.data;
}

function Delta({ k, donem }: { k: PanoKpi; donem: PanoDonem }) {
  const r = degisimRozeti(k, donem);
  return r ? <span title={r.metin}>{`${r.trend === "down" ? "−" : r.trend === "up" ? "+" : ""}${r.yuzde} ${r.kiyas}`}</span> : null;
}

/** Dönem seçicili sayı kartları; ölçülerin hepsi `null` ise bölüm hiç çizilmez. */
export function CariPeriodSummary({ customerId, compact = false }: { customerId: string; compact?: boolean }) {
  const [donem, setDonem] = useState<PanoDonem>("ay");
  const q = useQuery({ queryKey: ["customers", customerId, "period-summary", donem], queryFn: () => fetchPeriodSummary(customerId, donem), staleTime: 30_000 });
  const s = q.data;
  if (!s || (!s.sevk && !s.ciro && !s.siparis)) return null;
  const layout = compact ? "row" : undefined;
  return (
    <section aria-label="Dönem özeti" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Dönem özeti</h3>
        <DonemSecici donem={donem} onChange={setDonem} />
      </div>
      <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
        {s.sevk && (
          <StatCard label="Sevk (brüt)" icon={Truck} tone="blue" layout={layout} value={metre(s.sevk.metre.deger)}
            hint={<>{`${formatCount(s.sevk.irsaliye.deger)} irsaliye`} <Delta k={s.sevk.metre} donem={donem} /></>} />
        )}
        {s.ciro && s.ciro.tutarlar.length > 0 && (
          <StatCard label="Ciro (sevk tutarı)" icon={Coins} tone="violet" layout={layout}
            value={<span className="flex flex-col">{s.ciro.tutarlar.map((t) => <span key={t.paraBirimi}>{para(t.deger, t.paraBirimi)}</span>)}</span>}
            hint={s.ciro.fiyatsizSatir > 0 ? `${formatCount(s.ciro.fiyatsizSatir)} fiyatsız satır tutara girmedi` : s.ciro.tutarlar.length === 1 ? <Delta k={s.ciro.tutarlar[0] as PanoKpi} donem={donem} /> : "Para birimleri ayrı tutulur"} />
        )}
        {s.siparis && (
          <StatCard label="Alınan sipariş" icon={ClipboardList} tone="teal" layout={layout} value={metre(s.siparis.metre.deger)}
            hint={<>{`${formatCount(s.siparis.adet.deger)} sipariş`} <Delta k={s.siparis.metre} donem={donem} /></>} />
        )}
      </div>
    </section>
  );
}
