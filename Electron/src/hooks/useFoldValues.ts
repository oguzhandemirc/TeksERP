import { useQuery } from "@tanstack/react-query";
import { FOLD_CATALOG_QUERY_KEY, loadFoldValues } from "@/lib/fold-catalog";

/**
 * Kat değerleri (2-KAT / 4-KAT / TUP / fabrikanın eklediği 6-KAT…).
 *
 * TEK OKUMA NOKTASI — iş emri formu, reçete formu, envanter filtresi ve cihaz
 * rolü seçicisi bunu paylaşır. Öncesinde aynı `["2-KAT","4-KAT"]` dizisi dört
 * ayrı dosyada literaldi ve fabrika yeni bir kat ekleyemiyordu.
 *
 * ⚠️ Fallback YOK: katalog boşsa boş dizi döner ve çağıran bunu ekranda söyler.
 * Sabit iki tuşa düşmek, panelden eklenmiş değeri sessizce yok saymaktır.
 */
export function useFoldValues() {
  const q = useQuery({
    queryKey: FOLD_CATALOG_QUERY_KEY,
    queryFn: loadFoldValues,
    staleTime: 60_000,
  });
  return {
    values: q.data ?? [],
    isLoading: q.isLoading,
    /** Katalog okundu ama hiç değer yok — ekranda uyarı basılmalı. */
    isEmpty: !q.isLoading && (q.data?.length ?? 0) === 0,
  };
}
