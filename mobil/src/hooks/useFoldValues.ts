import { useQuery } from '@tanstack/react-query';
import {
  fabricPropertyService,
  type FabricPropertyValue,
} from '../services/fabricProperty.service';

/** Tüm kat tüketicileri AYNI cache satırını paylaşsın. */
export const FOLD_VALUES_QUERY_KEY = ['fabric-properties', 'fold-values'] as const;

/**
 * Kat değerleri — Tambur kesim/finalize tuşları, Manuel Top Ekle ve Hızlı İş
 * Emri sihirbazı bunu paylaşır.
 *
 * ⚠️ Öncesinde `['2-KAT','4-KAT']` dizisi mobilde BEŞ ayrı yerde literaldi;
 * fabrika 6-KAT ekleyince tablette görünmüyordu. Fallback bilinçli olarak YOK
 * (bkz. `fabricPropertyService.getFoldValues`).
 *
 * Çevrimdışı: react-query kalıcı cache'i (AsyncStorage) son başarılı listeyi
 * tutar; ilk kurulumda ağ yoksa liste boş gelir ve ekran uyarı basar.
 */
export function useFoldValues() {
  const q = useQuery({
    queryKey: FOLD_VALUES_QUERY_KEY,
    queryFn: fabricPropertyService.getFoldValues,
    staleTime: 10 * 60 * 1000,
  });
  const values: FabricPropertyValue[] = q.data ?? [];
  return {
    values,
    isLoading: q.isLoading,
    /** Katalog okundu ama değer yok → ekran "kat tanımlı değil" demeli. */
    isEmpty: !q.isLoading && values.length === 0,
  };
}
