// Kayıtlı siparişin plan satırlarında fire kaynağı (B6): sipariş yüzdeyi saklar, kaynağı saklamaz → OrderSummary ile
// AYNI önizleme sorgusu (aynı anahtar, tek istek) bugünkü kartlarla sorulur; değer değiştiyse "açılıştaki değer".
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useWarpingPreview } from "./service";
import type { WarpingOrder } from "./types";
import { orderPreviewBody, wasteSourceOf, type WasteSourceLabel } from "./waste-model";

export function useOrderWasteSource(o: WarpingOrder | undefined): (y: { yarnItemId: string; wastePct: string }) => WasteSourceLabel {
  const { hasPermission } = useRoleAccess();
  // Önizleme ucu `warping-order:write` ister; izinsiz kullanıcıda kaynak basılmaz (yüzde yine görünür).
  const ask = !!o && hasPermission("warping-order:write") && o.yarns.some((y) => Number(y.wastePct) > 0);
  const pv = useWarpingPreview(ask && o ? orderPreviewBody(o) : null);
  return (y) => (Number(y.wastePct) > 0 ? wasteSourceOf(y.yarnItemId, y.wastePct, pv.data?.data) : null);
}
