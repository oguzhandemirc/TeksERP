// İE detayı "Sarfiyat" kartı (2026-11-10): şu ana kadar harcanan sarf (poşet, kurşun ipi …) + maliyet.
// Maliyet sütunu yalnız alan yanıttaysa (izni sunucu uygular, istemci ikinci kez yorumlamaz); bilinmeyen maliyet "bilinmiyor".
// Sarf stoğu kapalıysa ve satır yoksa yalnız ayar yolu söylenir; ticaret modülü kapalı kurulumda kart hiç çizilmez.
import { useQuery } from "@tanstack/react-query";
import { formatFixed, formatNumber } from "@/lib/format";
import { flagSettingTrail } from "@/lib/flag-setting-path";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { V3Section } from "./V3Section";
import { CONSUMABLE_USAGE_KEY, getWorkOrderConsumableUsage, type ConsumableUsage } from "./consumableUsage";

const UNIT_TR: Record<string, string> = { MT: "m", KG: "kg", ADET: "adet" };
const tl = (v: string | null | undefined) => (v == null ? null : `${formatFixed(v, 2)} ₺`);
const qtyText = (q: string, unit: string) => `${formatNumber(Number(q), Number.isInteger(Number(q)) ? 0 : 2)} ${UNIT_TR[unit] ?? unit}`;

function Unknown() {
  return <span className="text-muted-foreground" title="Fiyatlı mal kabul girişi yok ya da kur bulunamadı">bilinmiyor</span>;
}

export function ConsumableUsageView({ data }: { data: ConsumableUsage }) {
  const showCost = data.rows.some((r) => "costTry" in r);
  return (
    <div className="space-y-2 text-sm" data-testid="wo-consumables">
      {!data.enabled && (
        <p className="rounded-md border p-2 text-muted-foreground" data-testid="wo-consumables-off">
          Sarf stoğu kapalı — {flagSettingTrail("consumableStockEnabled")}
        </p>
      )}
      {data.rows.length === 0 && data.enabled && <p className="text-muted-foreground">Bu iş emrinde henüz sarf düşümü yok.</p>}
      {data.rows.length > 0 && (
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-1">Kalem</th>
              <th className="py-1 text-right">Miktar</th>
              {showCost && <th className="py-1 text-right">Maliyet</th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.itemId} className="border-t">
                <td className="py-1">{r.name}</td>
                <td className="py-1 text-right tabular-nums">
                  {qtyText(r.qty, r.unit)}
                  {r.kursunKg && <span className="ml-1 text-muted-foreground">≈ {formatNumber(Number(r.kursunKg), 2)} kg</span>}
                </td>
                {showCost && <td className="py-1 text-right tabular-nums">{tl(r.costTry) ?? <Unknown />}</td>}
              </tr>
            ))}
          </tbody>
          {showCost && (
            <tfoot>
              <tr className="border-t font-medium">
                <td className="py-1" colSpan={2}>Toplam</td>
                <td className="py-1 text-right tabular-nums" data-testid="wo-consumables-total">{tl(data.totalCostTry) ?? <Unknown />}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {data.customer && (
        <p className="text-muted-foreground" data-testid="wo-consumables-customer">
          Müşteriye (kurşun, bugünkü gram fiyatı): <b>{tl(data.customer.amountTry) ?? "fiyat yok"}</b>
          {data.customer.diffTry != null && <> · Fark: <b>{tl(data.customer.diffTry)}</b></>}
        </p>
      )}
    </div>
  );
}

export function ConsumableUsageCard({ workOrderId }: { workOrderId: string }) {
  const ticaret = useFeatureFlags().data?.data?.ticaretEnabled ?? false;
  const q = useQuery({ queryKey: [CONSUMABLE_USAGE_KEY, workOrderId], queryFn: () => getWorkOrderConsumableUsage(workOrderId), enabled: ticaret, staleTime: 30_000 });
  if (!ticaret || !q.data) return null;
  return (
    <V3Section title="Sarfiyat">
      <ConsumableUsageView data={q.data} />
    </V3Section>
  );
}
