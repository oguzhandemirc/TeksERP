// Asgari stok hücresi (İplik Stoğu · Sarf Stoğu): eşik + "Asgari altı" rozeti. Karar SUNUCUDA (`belowMinStock`);
// burada yalnız çizilir — istemci eşik karşılaştırması yapmaz (tek yüklem `min-stock.helper.isBelowMinStock`).
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { unitLabel } from "@/lib/item-unit";

export const MIN_STOCK_BADGE_TEXT = "Asgari altı";

export function minStockText(minStockQty: string | null, unit: string): string {
  return minStockQty == null ? "—" : `${formatNumber(minStockQty, 3)} ${unitLabel(unit)}`;
}

export function MinStockCell({ minStockQty, below, unit }: { minStockQty: string | null; below: boolean; unit: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
      {below && (
        <Badge variant="warning" title="Eldeki miktar asgari stoğun altında — yeniden sipariş zamanı">
          {MIN_STOCK_BADGE_TEXT}
        </Badge>
      )}
      <span className={minStockQty == null ? "text-muted-foreground" : ""}>{minStockText(minStockQty, unit)}</span>
    </span>
  );
}
