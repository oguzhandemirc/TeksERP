import { formatMoney, formatNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { CustomerSummaryAccess, CustomerSummaryQueries } from "./useCustomerSummary";

interface Tile {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

/** Para birimi başına tutarlar tek satır ("1.250,00 ₺ · 300,00 $"); boşsa null. */
function moneyLine(rows: Array<{ currency: string; amount: number }>): string | null {
  const shown = rows.filter((r) => r.amount !== 0);
  return shown.length === 0 ? null : shown.map((r) => formatMoney(r.amount, r.currency)).join(" · ");
}

function collectTiles(access: CustomerSummaryAccess, q: CustomerSummaryQueries): { tiles: Tile[]; loading: boolean } {
  const tiles: Tile[] = [];
  let loading = false;
  const stats = q.stats.data?.data;
  if (access.orders) {
    if (q.stats.isLoading) loading = true;
    else if (stats) {
      tiles.push({ key: "orders", label: "Sipariş", value: formatNumber(stats.totalCount, 0), hint: "iptaller hariç" });
      tiles.push({ key: "open", label: "Açık miktar", value: `${formatNumber(stats.totalOpenQty, 1)} m`, hint: "istenen − sevk" });
      const amount = access.amounts ? moneyLine(Object.entries(stats.amountByCurrency ?? {}).map(([currency, amount]) => ({ currency, amount }))) : null;
      if (amount) tiles.push({ key: "amount", label: "Sipariş tutarı", value: amount, hint: "iptaller hariç" });
    }
  }
  const ship = q.shipments.data?.summary;
  if (access.shipping) {
    if (q.shipments.isLoading) loading = true;
    else if (ship) {
      tiles.push({
        key: "shipped",
        label: "Sevk (brüt)",
        value: `${formatNumber(ship.totalMeters, 1)} m`,
        hint: `${formatNumber(ship.shipmentCount, 0)} sevk · ${formatNumber(ship.totalKg, 1)} kg`,
      });
    }
  }
  const ret = q.returns.data?.summary;
  if (access.returns) {
    if (q.returns.isLoading) loading = true;
    else if (ret) tiles.push({ key: "returns", label: "İade", value: `${formatNumber(ret.totalQty, 1)} m`, hint: `${formatNumber(ret.count, 0)} top · ayrı belge` });
  }
  if (access.amounts) {
    if (q.cari.isLoading) loading = true;
    else if (q.cari.data) {
      const bal = moneyLine(q.cari.data.balances.map((b) => ({ currency: b.currency, amount: b.balance })));
      tiles.push({ key: "balance", label: "Cari bakiye", value: bal ?? "0", hint: q.cari.data.code });
    }
  }
  return { tiles, loading };
}

/**
 * Toplam şeridi — YALNIZ uçların verdiği toplamlar (istemcide toplama yok); veremeyen,
 * izni olmayan ya da hata veren kutu çizilmez. Sevk BRÜT, iade ayrı kutu (düşülmez);
 * tutar ve bakiye yalnız finans okuma kapısıyla.
 */
export function CustomerSummaryStrip({ access, q }: { access: CustomerSummaryAccess; q: CustomerSummaryQueries }) {
  const { tiles, loading } = collectTiles(access, q);
  if (tiles.length === 0 && !loading) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="summary-strip">
      {tiles.map((t) => (
        <div key={t.key} className="rounded-md border bg-muted/30 px-3 py-2" data-testid={`summary-tile-${t.key}`}>
          <div className="text-[11px] text-muted-foreground">{t.label}</div>
          <div className="truncate text-base font-semibold tabular-nums" title={t.value}>
            {t.value}
          </div>
          {t.hint && <div className="truncate text-[11px] text-muted-foreground">{t.hint}</div>}
        </div>
      ))}
      {loading && <Skeleton className="h-[60px] w-full" />}
    </div>
  );
}
