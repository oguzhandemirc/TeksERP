import { useQuery, type QueryClient } from "@tanstack/react-query";
import { sackHubService } from "./service";

/** Tek çuvalın canlı dökümü — editör içerik kaynağı (rulo + kartela). */
export function useSackContents(sackId: string | null) {
  return useQuery({
    queryKey: ["sack-contents", sackId],
    queryFn: () => sackHubService.contents(sackId!),
    enabled: !!sackId,
    staleTime: 5_000,
  });
}

/**
 * Çuval hub'ına dokunan işlemler sonrası ilgili tüm cache'leri tazele. Tek yer:
 * içerik düzenleme (okut/tart/çıkar/taşı/sil) ve sevkiyat kurma aynı ağı besler.
 * `shipment` = sevkiyat da değişti (kurma/iptal) → sevkiyat listeleri + detay da.
 */
export function invalidateSackHub(qc: QueryClient, opts?: { shipment?: boolean }): void {
  void qc.invalidateQueries({ queryKey: ["packing"] }); // pool + open-orders
  void qc.invalidateQueries({ queryKey: ["pool"] });
  void qc.invalidateQueries({ queryKey: ["sack-search"] });
  void qc.invalidateQueries({ queryKey: ["sack-contents"] });
  void qc.invalidateQueries({ queryKey: ["sack-store"] });
  void qc.invalidateQueries({ queryKey: ["orders"] });
  void qc.invalidateQueries({ queryKey: ["rolls"] });
  if (opts?.shipment) {
    void qc.invalidateQueries({ queryKey: ["shipments"] });
    void qc.invalidateQueries({ queryKey: ["shipment-detail"] });
  }
}
