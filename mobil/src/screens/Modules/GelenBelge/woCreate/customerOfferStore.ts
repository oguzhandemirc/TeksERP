// Müşteri teklifi modalının ekran düzeyi durumu: her not için otomatik açılış BİR KEZ (kullanıcı kapatınca satır yeniden
// çizilse de tekrar açılmaz) ve aynı anda TEK açık teklif (çok belgeli masada modallar üst üste binmesin; sıradaki not
// açık olan kapanınca açılır). Modül düzeyinde tutulur: satır bileşeni yeniden bağlansa da "gösterildi" bilgisi kalır.
import { useSyncExternalStore } from 'react';

const autoOpened = new Set<string>();
let active: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Şu an açık teklifin notu (yoksa null). */
export function useActiveOffer(): string | null {
  return useSyncExternalStore(subscribe, () => active, () => active);
}

/** Otomatik açılış hakkı: not daha önce açılmadıysa ve başka teklif açık değilse alınır (alındıysa true). */
export function claimAutoOpen(noteId: string): boolean {
  if (autoOpened.has(noteId) || active !== null) return false;
  autoOpened.add(noteId);
  active = noteId;
  emit();
  return true;
}

/** Elle açılış ("öneriyi aç"): otomatik hakkı da tüketir. */
export function markOpen(noteId: string): void {
  autoOpened.add(noteId);
  if (active === noteId) return;
  active = noteId;
  emit();
}

/** Teklif kapandı (seçildi, kaydedildi, vazgeçildi ya da satır söküldü). */
export function releaseOffer(noteId: string): void {
  if (active !== noteId) return;
  active = null;
  emit();
}

/** Yalnız testler: modül durumunu sıfırlar. */
export function resetCustomerOfferStore(): void {
  autoOpened.clear();
  active = null;
  emit();
}
