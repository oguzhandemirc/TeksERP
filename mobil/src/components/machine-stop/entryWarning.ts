// =============================================================================
// AÇIK DURUŞTA GİRİŞ UYARISI — Kurşun gramaj / Tambur metre (D4-A2b, DALGA4 §2.5/5 · K2)
// =============================================================================
// UYARI, ret DEĞİL: duruş ile metre yazımda bağlanmaz; giriş her durumda gönderilir (sunucu kapısı yok).
// Koşul = açık duruş ∧ `uretim.makineDurusAcikUyarisi` (`useMachineStopControl().entryWarning`).
// =============================================================================
import Toast from 'react-native-toast-message';

/** Uyarı metni; `active` false ise (duruş yok ya da ayar kapalı) null. */
export function stopOpenEntryWarning(active: boolean): { title: string; detail: string } | null {
  if (!active) return null;
  return { title: 'Makine duruşta görünüyor — dokunuş engellenmedi', detail: 'Makine çalışıyorsa üstteki bantta "Çalıştı" ile duruşu kapatın.' };
}

/** Uyarıyı Toast ile gösterir; gönderimi ASLA kesmez (çağıran akışına devam eder). */
export function showStopOpenEntryWarning(active: boolean): void {
  const w = stopOpenEntryWarning(active);
  if (w) Toast.show({ type: 'info', text1: w.title, text2: w.detail, visibilityTime: 5000 });
}
