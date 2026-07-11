import { useQuery, type QueryClient } from "@tanstack/react-query";
import { packingService } from "./service";

/** Müşterinin havuz çuvalları (açık + mühürlü) — paketleme workspace canlı kaynağı. */
export function useCustomerPool(customerId: string | null) {
  return useQuery({
    queryKey: ["packing", "pool", customerId],
    queryFn: () => packingService.listCustomerPool(customerId!),
    enabled: !!customerId,
    staleTime: 5_000,
  });
}

/** Paketleme sonrası ilgili cache'leri tazele (havuz + arama + board + sipariş + rulo). */
export function invalidatePoolData(qc: QueryClient, customerId: string) {
  void qc.invalidateQueries({ queryKey: ["packing", "pool", customerId] });
  void qc.invalidateQueries({ queryKey: ["packing", "open-orders"] });
  void qc.invalidateQueries({ queryKey: ["sack-search"] });
  void qc.invalidateQueries({ queryKey: ["sack-store"] });
  void qc.invalidateQueries({ queryKey: ["rolls"] });
  void qc.invalidateQueries({ queryKey: ["orders"] });
}
