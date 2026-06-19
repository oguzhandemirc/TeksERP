import { useQuery, type QueryClient } from "@tanstack/react-query";
import { packingService } from "./service";

/** Paketleme/düzeltme workspace'inin tek doğruluk kaynağı (tam sevkiyat detayı). */
export const shipmentDetailKey = (id: string) => ["packing", "shipment", id] as const;

/**
 * Sevkiyat detayını çek (orders + rolls[sackId] + sacks + summary). Workspace ve
 * çuval listesi aynı anahtarı paylaşır → React Query tek istekte birleştirir.
 */
export function useShipmentDetail(shipmentId: string | null) {
  return useQuery({
    queryKey: shipmentDetailKey(shipmentId ?? ""),
    queryFn: () => packingService.getShipment(shipmentId!),
    enabled: !!shipmentId,
    staleTime: 5_000,
  });
}

/**
 * İçerik mutasyonundan sonra etkilenen tüm cache'leri tazele. Çuval içeriği
 * değişince (ekle/çıkar/taşı/takas/tart/sil) workspace + Çuval Depo board'u +
 * çuval arama + top tabloları bayatlar; READY/AT_DOOR'da recommit sipariş
 * karşılanmasını da değiştirir.
 */
export function invalidateShipmentData(qc: QueryClient, shipmentId: string) {
  void qc.invalidateQueries({ queryKey: shipmentDetailKey(shipmentId) });
  void qc.invalidateQueries({ queryKey: ["packing"] });
  void qc.invalidateQueries({ queryKey: ["sack-store"] });
  void qc.invalidateQueries({ queryKey: ["sack-contents"] });
  void qc.invalidateQueries({ queryKey: ["sack-search"] });
  void qc.invalidateQueries({ queryKey: ["rolls"] });
  void qc.invalidateQueries({ queryKey: ["shipments"] });
  void qc.invalidateQueries({ queryKey: ["shipment-detail", shipmentId] });
  void qc.invalidateQueries({ queryKey: ["orders"] });
}
