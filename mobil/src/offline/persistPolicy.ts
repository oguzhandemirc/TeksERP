// =============================================================================
// Cache kapsam politikası — NE diske yazılır, logout'ta NE korunur.
// =============================================================================
// İki ayrı liste, iki ayrı soru (SAHA-AG-DAYANIKLILIK.md §S2/§S6):
//
// 1) BOOTSTRAP_QUERY_KEYS — "logout'ta korunur": login ekranının PUBLIC verisi
//    (kullanıcı listesi, giriş yöntemleri, cihaz durumu) + feature-flag'ler.
//    Bunlar kullanıcıya özel DEĞİL; korunurlarsa logout→login ekranı son bilinen
//    veriyle ANINDA çizilir ve arkada tazelenir (stale-while-revalidate).
//
// 2) PERSISTED_QUERY_KEYS — "diske yazılır": bootstrap + kullanıcı tercihleri
//    (modül sırası). BUNUN DIŞINDA HİÇBİR query persist edilmez — üretim ekran
//    verilerinin app restart'ta "dünkü haliyle" görünmesi (hayalet veri) biter.
//
// Mutation tarafı: TanStack default'u yalnız isPaused'u persist eder. Aktif
// retry'daki (pending) İSTASYON kaydı app kill'de kaybolurdu — istasyon
// mutation'ları idempotent olduğundan (client-key + P2002) pending'i de
// persist etmek replay-güvenlidir; restore'da paused olarak döner.

import type { QueryKey } from '@tanstack/react-query';

/** Logout'ta korunan public bootstrap anahtarları (prefix eşleşmesi). */
export const BOOTSTRAP_QUERY_KEYS: readonly (readonly string[])[] = [
  ['auth', 'mobile-users'],
  ['auth', 'login-methods'],
  ['feature-flags'],
  ['device', 'status'],
  ['device', 'assignment-required'],
];

/** Diske (AsyncStorage persister) yazılan anahtarlar: bootstrap + tercihler. */
export const PERSISTED_QUERY_KEYS: readonly (readonly string[])[] = [
  ...BOOTSTRAP_QUERY_KEYS,
  ['preferences'],
];

/** queryKey verilen prefix ile başlıyor mu? (['auth','mobile-users'] eşleşir;
 *  ['auth'] prefix'i tüm auth anahtarlarını kapsardı — listeler tam prefix tutar.) */
export function keyStartsWith(queryKey: QueryKey, prefix: readonly string[]): boolean {
  if (!Array.isArray(queryKey) || queryKey.length < prefix.length) return false;
  return prefix.every((part, i) => queryKey[i] === part);
}

export function isBootstrapQueryKey(queryKey: QueryKey): boolean {
  return BOOTSTRAP_QUERY_KEYS.some((p) => keyStartsWith(queryKey, p));
}

export function isPersistedQueryKey(queryKey: QueryKey): boolean {
  return PERSISTED_QUERY_KEYS.some((p) => keyStartsWith(queryKey, p));
}

/** İstasyon outbox mutation'ı mı? (mutations.ts STATION_MUT anahtarları) */
export function isStationMutationKey(mutationKey: unknown): boolean {
  return Array.isArray(mutationKey) && mutationKey[0] === 'station';
}

/** Persister shouldDehydrateMutation: paused (default davranış) ∪ pending-istasyon.
 *  Tamamlanmış/idle mutation'lar ve istasyon-dışı pending'ler yazılmaz. */
export function shouldPersistMutation(mutation: {
  state: { isPaused: boolean; status: string };
  options: { mutationKey?: unknown };
}): boolean {
  if (mutation.state.isPaused) return true;
  return (
    mutation.state.status === 'pending' && isStationMutationKey(mutation.options.mutationKey)
  );
}
