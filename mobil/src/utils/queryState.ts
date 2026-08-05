// =============================================================================
// "Liste boş" ile "listeyi ALAMADIM" ayrımı — TEK KAYNAK.
//
// SAHA VAKASI (2026-08-05): tablet Wi-Fi'siz kalınca Sipariş listesi
// "Henüz sipariş yok" gösterdi. DB'de 75 sipariş vardı. Operatöre söylenen şey
// bir YALANDI ve sebebini gizliyordu.
//
// KÖK NEDEN: React Query'nin varsayılan `networkMode: 'online'` davranışı —
// cihaz çevrimdışıyken sorgu HATA VERMEZ, **duraklatılır**:
//     status = 'pending' · fetchStatus = 'paused'
// Dolayısıyla `isError` FALSE, `isFetching` FALSE → `isLoading` da FALSE kalır.
// Yalnız `isError`e bakan bir ekran bu durumu "başarıyla geldi, içi boş" sanır.
//
// Sunucu KAPALI ama Wi-Fi AÇIK olduğunda istek gerçekten düşer → `isError` true
// olur ve o yol zaten doğru çalışıyordu; bu yüzden hata ilk denemede görünmedi.
// İki durum AYRI ve ikisi de "boş liste" DEĞİLDİR.
// =============================================================================

export type QueryProblem = 'offline' | 'error';

/** Kullanıcıya gösterilecek metin — sebep + çare, tek cümle. */
export const QUERY_PROBLEM_TEXT: Record<QueryProblem, string> = {
  offline: 'Çevrimdışısınız — liste alınamıyor. Bağlantı gelince yenileyin.',
  error: 'Liste alınamadı — sunucuya ulaşılamıyor. Bağlantıyı kontrol edip yenileyin.',
};

/**
 * Sorgu "veri gösterilemiyor" durumunda mı? `null` = sorun yok (gerçekten boş
 * ya da dolu). React Query sonucundan yalnız iki bayrak okunur; `useQuery` ve
 * `useInfiniteQuery` ikisinde de var.
 *
 * ⚠️ `isPaused`i ATLAMA — bu modülün varlık sebebi odur.
 */
export function queryProblem(q: { isError: boolean; isPaused: boolean }): QueryProblem | null {
  if (q.isPaused) return 'offline';
  if (q.isError) return 'error';
  return null;
}

/** Boş-durum metnini seçer: sorun varsa sebebi, yoksa çağıranın normal metni. */
export function emptyOrProblemText(
  q: { isError: boolean; isPaused: boolean },
  normalEmptyText: string,
): string {
  const p = queryProblem(q);
  return p ? QUERY_PROBLEM_TEXT[p] : normalEmptyText;
}
