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
 * Çevrimdışı: bu anahtar kalıcı cache allowlist'inde DEĞİL (persistPolicy yalnız
 * bootstrap + tercihleri diske yazar) — ağ yoksa liste BOŞ gelir ve ekran uyarı
 * basar. (Buradaki eski "AsyncStorage son listeyi tutar" iddiası yanlıştı.)
 *
 * ⚠️⚠️ BOŞ LİSTE KARARLI SABİTTİR (`EMPTY_FOLD_VALUES`) — `q.data ?? []` YAZMA.
 * 2026-08-15 saha çökmesinin (SM-X230, 2.7.0–2.7.2) KÖK NEDENİ tam buydu:
 * sunucu erişilemez + cache yokken `q.data` süresiz `undefined` kalır ve `?? []`
 * HER render'da YENİ dizi üretir. TamburScreen'in kat-varsayılanı effect'i bu
 * diziyi bağımlılık listesinde taşıdığı için effect her render'da yeniden koşup
 * `setWork({...})` (yeni nesne, bail yok) çağırdı → gerçek sonsuz döngü →
 * `Maximum update depth exceeded` → uygulama ekran açılır açılmaz düştü.
 * Aynı kural veri dönen HER hook için geçerli: boşluk değeri modül sabitidir.
 */
const EMPTY_FOLD_VALUES: FabricPropertyValue[] = [];

export function useFoldValues() {
  const q = useQuery({
    queryKey: FOLD_VALUES_QUERY_KEY,
    queryFn: fabricPropertyService.getFoldValues,
    staleTime: 10 * 60 * 1000,
  });
  const values: FabricPropertyValue[] = q.data ?? EMPTY_FOLD_VALUES;
  return {
    values,
    isLoading: q.isLoading,
    /** Katalog okundu ama değer yok → ekran "kat tanımlı değil" demeli. */
    isEmpty: !q.isLoading && values.length === 0,
  };
}
