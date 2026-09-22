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
// persist etmek replay-güvenlidir.
//
// DİKKAT (denetimde çıktı): hydrate() state'i AYNEN geri kurar — pending +
// isPaused:false persist edilen kayıt restore'da paused OLMAZ ve TÜM resume
// yolları (resumePausedMutations) yalnız isPaused'u taradığından bir daha asla
// denenmez (zombi → sessiz kayıt kaybı). Bu yüzden persister'ın deserialize'ı
// revivePendingStationMutations ile bu kayıtları okuma anında paused'a çevirir.

import type { QueryKey } from '@tanstack/react-query';

/** Logout'ta korunan public bootstrap anahtarları (prefix eşleşmesi). */
export const BOOTSTRAP_QUERY_KEYS: readonly (readonly string[])[] = [
  ['auth', 'mobile-users'],
  ['auth', 'login-methods'],
  ['feature-flags'],
  // Okutma seri tablosu: biçim meta verisi, kullanıcıya özel DEĞİL. Diske
  // yazılır ki tablet ağsız açıldığında da barkod türünü çözebilsin.
  ['scan-series'],
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

// Persister deserialize düzeltmesi için minimal yapısal tipler — kütüphanenin
// PersistedClient tipine bağımlılık kurmadan (sürüm oynaklığına dayanıklı).
interface PersistedMutationLike {
  mutationKey?: unknown;
  state?: { status?: string; isPaused?: boolean };
  /** Mutation meta'sı dehydrate/hydrate turundan geçer (query-core hydration.js). */
  meta?: Record<string, unknown>;
}

/**
 * Diriltilen kaydın damgası — "bu kaydın ARDINDA EKRAN YOK".
 *
 * Uygulama yeniden açıldığında kuyruktan replay edilen istasyon kaydının, onu
 * yaratan ekranı artık yoktur; sunucu 409 ile SORU sorarsa (POSSIBLE_DUPLICATE
 * "aynı top mu, ayrı top mu") o soruyu soracak modal da yoktur. Damga olmadan
 * bu 409 hiçbir yüzeyde görünmeden düşüyordu — fiziksel top sistemde hiç
 * doğmuyordu ve operatör bunu ancak envanterde arayınca fark edebiliyordu
 * (BULGU-T3-001, S1).
 */
export const EKRANSIZ_META = 'ekransizDiriltildi';
interface PersistedClientLike {
  clientState?: { mutations?: PersistedMutationLike[] };
}

/**
 * Restore düzeltmesi (ZOMBİ ÖNLEME): pending + isPaused:false persist edilmiş
 * İSTASYON kaydını okuma anında paused'a çevirir → resumePausedMutations onu
 * görür, registry'deki mutationFn ile replay eder (idempotent, güvenli).
 * Idempotent: zaten paused olana ve istasyon-dışına dokunmaz; bozuk/eksik
 * yapıda girdiyi aynen döndürür.
 */
export function revivePendingStationMutations<T extends PersistedClientLike>(persisted: T): T {
  const mutations = persisted?.clientState?.mutations;
  if (!Array.isArray(mutations)) return persisted;
  for (const m of mutations) {
    if (
      isStationMutationKey(m?.mutationKey) &&
      m.state?.status === 'pending' &&
      !m.state.isPaused
    ) {
      m.state.isPaused = true;
      // Ekransızlık damgası: replay 409 alırsa toast BASILIR (announceFailure).
      m.meta = { ...(m.meta ?? {}), [EKRANSIZ_META]: true };
    }
  }
  return persisted;
}
