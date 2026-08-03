// =============================================================================
// TeksERP - Liste gürültüsü: iptal edilmiş kayıtları varsayılan olarak gizle
// =============================================================================
// Sipariş / iş emri / sevkiyat listelerinde iptal edilmiş kayıtlar operatörün
// kararına girmez ama satır sayısını şişirir. Panel bu bayrağı GÖNDEREREK gizler
// ("İptalleri göster" tiki kapalıyken `filter[hideCancelled]=true`).
//
// ⚠️ Yön bilinçli: bayrak GİZLEMEYİ ister, göstermeyi değil. Parametre hiç
// gelmezse davranış eskisi gibi kalır (hepsi listelenir) → mobil ve entegrasyon
// istemcileri bu değişiklikten etkilenmez. Ters kurgu (varsayılan gizli, göstermek
// için parametre) sessizce mobil listeleri budardı.
// =============================================================================

/** Panelin gönderdiği filtre anahtarı. Tek yerde tanımlı — servislere kopyalama. */
export const HIDE_CANCELLED_FILTER = "hideCancelled";

/**
 * İptal-gizleme `where` parçası üretir. Uygulanmayacaksa `undefined` döner.
 *
 * İki koşul birden aranır:
 *  1. `filter[hideCancelled]=true` gelmiş olmalı.
 *  2. Kullanıcı DURUM filtresini AÇIKÇA kullanmamış olmalı. Kullanmışsa niyetini
 *     zaten söylemiştir; üstüne bir de dışlama eklemek "Durum: İptal" seçildiğinde
 *     listeyi boş bırakırdı (iki koşul çelişir) ve sebebi ekranda görünmezdi.
 */
export function buildHideCancelledWhere(
  filters: Record<string, string | string[]>,
  cancelledStatuses: readonly string[],
): { status: { notIn: string[] } } | undefined {
  if (filters[HIDE_CANCELLED_FILTER] !== "true") return undefined;
  if (filters.status) return undefined;
  return { status: { notIn: [...cancelledStatuses] } };
}
