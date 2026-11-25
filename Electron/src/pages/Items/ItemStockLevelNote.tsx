// Ürün penceresi Stok bölümü: kartın eldeki miktarı asgari stoğun altındaysa tek uyarı satırı. Eldeki miktar
// stok ekranlarının AYNI ucundan (iplik `/api/yarn/stocks` kalem toplamı · sarf `/api/consumable-stock`),
// asgari altı kararı sunucudan; modül kapalı ya da okuma izni yoksa hiç sorulmaz (403 tostu çıkmasın).
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { isModuleEnabled } from "@/lib/license/module-enabled";
import { formatNumber } from "@/lib/format";
import { unitLabel } from "@/lib/item-unit";
import { ItemType } from "@/types/enums";
import { listYarnStocks } from "@/pages/Operations/Yarn/service";
import { listConsumableStock } from "@/pages/Operations/ConsumableStock/service";

interface StockLevel {
  onHand: string;
  below: boolean;
}

async function readStockLevel(itemType: string, itemId: string): Promise<StockLevel> {
  if (itemType === ItemType.YARN) {
    const r = await listYarnStocks({ page: 1, pageSize: 1, itemId });
    return { onHand: String(r.totals.balanceKg), below: (r.totals.belowMinItemCount ?? 0) > 0 };
  }
  const r = await listConsumableStock({ itemId });
  const row = r.rows[0];
  return { onHand: row?.balance ?? "0", below: row?.belowMinStock === true };
}

export function ItemStockLevelNote({ itemId, itemType, unit, minStockQty }: { itemId: string | null; itemType: string; unit: string; minStockQty: string | number | null | undefined }) {
  const flags = useFeatureFlags().data?.data;
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const canRead =
    itemType === ItemType.YARN
      ? isModuleEnabled(flags, "iplikEnabled") && hasPermission("warehouse:read")
      : itemType === ItemType.CONSUMABLE && isModuleEnabled(flags, "ticaretEnabled") && hasAnyPermission(["goods-receipt:read", "goods-receipt:write"]);
  const enabled = Boolean(itemId) && minStockQty != null && minStockQty !== "" && canRead;
  // Anahtar ekranların önekiyle başlar: hareket yazınca stok ekranının tazelemesi bunu da kapsar.
  const q = useQuery({
    queryKey: [itemType === ItemType.YARN ? "yarn" : "consumable-stock", "item-level", itemId ?? ""],
    queryFn: () => readStockLevel(itemType, itemId as string),
    enabled,
  });
  if (!enabled || !q.data?.below) return null;
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Eldeki {formatNumber(q.data.onHand, 3)} {unitLabel(unit)} — asgari stoğun ({formatNumber(minStockQty, 3)} {unitLabel(unit)}) altında; yeniden sipariş zamanı.
    </p>
  );
}
