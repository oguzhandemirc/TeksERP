import { useQuery, type QueryClient } from "@tanstack/react-query";
import { sackHubService } from "./service";
import { invalidateDestinationLock } from "./destinationDefault";

/**
 * Çuval hub'ının LİSTE aileleri — mutasyon sonrası tazeleme (`invalidateSackHub`) ile sayfanın
 * "Yenile" düğmesi AYNI listeyi kullanır. react-query öneki dizi ELEMANI düzeyinde eşler:
 * `["packing"]` `["packing-groups", …]`ı KAPSAMAZ (K16, 2026-09-23 — tabletin açtığı parti
 * Yenile'de görünmüyordu). Yeni bir liste sorgusu bu aileye girer, yoksa Yenile onu atlar.
 */
export const SACK_HUB_KEYS: readonly (readonly string[])[] = [
  ["packing"], ["pool"], ["sack-search"], ["packing-groups"], ["packing-lot-summary"],
  ["sack-contents"], ["sack-store"], ["orders"], ["rolls"],
];

/**
 * Başka istemcinin (tablet · ikinci panel) açtığı/kapattığı partiyi gösteren sorguların tazelik
 * süresi. Genel 5 dk varsayılanı burada fazla uzun: yeniden bağlanan liste 15 sn'den eskiyse
 * sunucuya tekrar sorar.
 */
export const PACKING_LOT_STALE_MS = 15_000;

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
  for (const key of SACK_HUB_KEYS) {
    void qc.invalidateQueries({
      queryKey: [...key],
      // Silinen çuvalın dökümü tazelenmez (404 toast'ı — aşağıdaki not).
      ...(silinen && key[0] === "sack-contents" ? { predicate: (q) => q.queryKey[1] !== silinen } : {}),
    });
  }
  if (opts?.shipment) {
    void qc.invalidateQueries({ queryKey: ["shipments"] });
    void qc.invalidateQueries({ queryKey: ["shipment-detail"] });
    invalidateDestinationLock(qc);
  }
}
