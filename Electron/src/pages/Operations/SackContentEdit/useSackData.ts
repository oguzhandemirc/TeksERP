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
 *
 * `silinenSackId` = bu çağrı bir çuvalı SİLDİ. O çuvalın dökümü tazelenmez:
 * editör bir sonraki render'da kapanacak ama şu anda hâlâ mount'lu, ve tazeleme
 * artık var olmayan kaydı sorup 404 aldırır (sahada ölçüldü 2026-09-04/06:
 * başarılı her silmeden sonra operatöre kırmızı "Çuval bulunamadı" toast'ı
 * çıkıyordu — iki günde 13 kez).
 */
export function invalidateSackHub(
  qc: QueryClient,
  opts?: { shipment?: boolean; silinenSackId?: string },
): void {
  const silinen = opts?.silinenSackId;
  void qc.invalidateQueries({ queryKey: ["packing"] }); // pool + open-orders
  void qc.invalidateQueries({ queryKey: ["pool"] });
  void qc.invalidateQueries({ queryKey: ["sack-search"] });
  // Sevk partisi yüzeyleri çuval sayılarını taşır (liste · özet · detay) — çuval değişince tazelenir.
  void qc.invalidateQueries({ queryKey: ["packing-groups"] });
  void qc.invalidateQueries({ queryKey: ["packing-lot-summary"] });
  void qc.invalidateQueries({
    queryKey: ["sack-contents"],
    ...(silinen ? { predicate: (q) => q.queryKey[1] !== silinen } : {}),
  });
  void qc.invalidateQueries({ queryKey: ["sack-store"] });
  void qc.invalidateQueries({ queryKey: ["orders"] });
  void qc.invalidateQueries({ queryKey: ["rolls"] });
  if (opts?.shipment) {
    void qc.invalidateQueries({ queryKey: ["shipments"] });
    void qc.invalidateQueries({ queryKey: ["shipment-detail"] });
  }
}
