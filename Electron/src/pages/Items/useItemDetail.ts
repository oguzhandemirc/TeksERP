import { useQuery } from "@tanstack/react-query";
import { itemService } from "@/pages/Items/service";

/**
 * Tek kumaş detayını (allowedColors + allowedProperties dahil) TEK cache
 * girdisinde paylaşır. Bir sipariş satırında OrderLineColorPicker ve
 * LineRequiredPropertiesEditor aynı itemId için ayrı key'lerle (`item-allowed-colors`
 * / `item-allowed`) aynı GET /api/items/:id'yi iki kez atıyordu; ortak
 * `["item", itemId]` key'i ile satır başına tek istek (N satır → 2N yerine N).
 */
export function useItemDetail(itemId: string) {
  return useQuery({
    queryKey: ["item", itemId],
    queryFn: () => itemService.getById(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
  });
}
