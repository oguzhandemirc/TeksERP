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
 * "Tamamlananları gizle" (2026-08-17, iş emri listesi). İptalden AYRI bir
 * anahtar çünkü iki karar bağımsız: planlamacı bitmiş işleri gizleyip iptalleri
 * görmek isteyebilir. Aynı anahtarı paylaşsalardı biri açılınca diğeri de
 * açılırdı.
 */
export const HIDE_COMPLETED_FILTER = "hideCompleted";

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
  return buildHiddenStatusWhere(filters, { cancelled: cancelledStatuses });
}

/**
 * ÇOK BAYRAKLI hâli — gizlenecek statüler TEK `notIn` listesinde birleşir.
 *
 * ⚠️ Birleştirme ZORUNLU: iki ayrı `{ status: { notIn } }` nesnesi aynı `where`
 * içinde üst üste yazılırdı (ikincisi birinciyi EZER) ve "iptalleri de
 * tamamlananları da gizle" isteyen kullanıcı yalnız birinin uygulandığını
 * hiçbir yerde göremezdi.
 *
 * Durum filtresi açıkça seçilmişse HİÇBİRİ uygulanmaz — gerekçe yukarıdaki
 * `buildHideCancelledWhere` notunda (kullanıcı niyetini zaten söyledi).
 */
export function buildHiddenStatusWhere(
  filters: Record<string, string | string[]>,
  opts: { cancelled?: readonly string[]; completed?: readonly string[] },
): { status: { notIn: string[] } } | undefined {
  if (filters.status) return undefined;
  const hidden: string[] = [];
  if (filters[HIDE_CANCELLED_FILTER] === "true" && opts.cancelled) hidden.push(...opts.cancelled);
  if (filters[HIDE_COMPLETED_FILTER] === "true" && opts.completed) hidden.push(...opts.completed);
  if (hidden.length === 0) return undefined;
  return { status: { notIn: [...new Set(hidden)] } };
}
