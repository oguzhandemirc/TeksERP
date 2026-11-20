// Fatura ↔ bağlı devere kabullerinin beklenen ücreti (devere A2). Sunucu hesaplar (`warping-fee-match`); fark yalnız
// UYARIR, onayı engellemez. Bağsız faturada bant hiç çizilmez. Kaydedilmiş faturayı okur (formdaki yazılmamış hâli değil).
import { useQuery } from "@tanstack/react-query";
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";
import { formatQty } from "@/lib/format";
import { money } from "./service";
import { LUMP_INFO, feeQtyText, differenceText, expectedText, getWarpingFeeMatch, isLumpPrice, warpingFeeMatchKey, type WarpingFeeMatch } from "./warpingFee";

export function WarpingFeeMatchBand({ invoiceId, enabled = true, saved }: { invoiceId: string; enabled?: boolean; saved?: boolean }) {
  const q = useQuery({ queryKey: warpingFeeMatchKey(invoiceId), queryFn: () => getWarpingFeeMatch(invoiceId), enabled });
  if (!q.data) return null;
  return <WarpingFeeMatchView match={q.data} saved={saved} />;
}

export function WarpingFeeMatchView({ match: m, saved }: { match: WarpingFeeMatch; saved?: boolean }) {
  const warn = m.exceeded || m.currencyMismatch || m.missingPrice;
  const lump = m.orders.some((o) => isLumpPrice(o.feeUnitPrice));
  return (
    <div
      className={cn("rounded-md border p-2 text-xs", warn ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-muted/40")}
      data-testid="warping-fee-match"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">Devere ücreti</span>
        <span>Beklenen <b className="tabular-nums">{m.expectedTotal === null ? "—" : money(m.expectedTotal, m.currency)}</b></span>
        <span>Fatura net <b className="tabular-nums">{money(m.invoiceNet, m.currency)}</b></span>
        <span className={cn(m.exceeded && "font-medium")}>{differenceText(m)}</span>
        <InfoPopover
          label="Fark nasıl hesaplanır"
          desc={`Beklenen = dönen ölçü × siparişteki birim ücret (yeniden sarım ayara göre). Fatura net = KDV hariç ara toplam − iskonto. Tolerans %${formatQty(m.tolerancePct, 2)}; aşınca uyarır, onayı engellemez.${lump ? ` ${LUMP_INFO}` : ""}`}
        />
      </div>
      <ul className="mt-1 space-y-0.5">
        {m.orders.map((o) => (
          <li key={o.warpingOrderId} className="tabular-nums">
            {o.orderNo} · {o.receipts.length} kabul · {feeQtyText(o.qty, o.feeUnit)} · {expectedText(o.expectedAmount, o.feeCurrency)}
          </li>
        ))}
      </ul>
      {m.exceeded && <p className="mt-1">Fatura beklenenden toleransın üstünde ayrışıyor — onaydan önce devereci irsaliyeleriyle karşılaştırın.</p>}
      {saved && <p className="mt-1 text-[11px] opacity-80">Kaydedilmiş hâle göre; değişiklikleri kaydedince yenilenir.</p>}
    </div>
  );
}
