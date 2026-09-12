// =============================================================================
// Kabul iptali ENGELLENDİĞİNDE engelleyen kartelaların künyesi
// =============================================================================
// Yıkıcı işlem engellenince operatör "N kartela engelliyor" değil HANGİ kartelalar
// engelliyor bilgisini görmek zorunda (kök CLAUDE.md: etkilenen HER kaydı listele).
// Backend bu listeyi `details.blocked` ile üretiyor; bu yardımcı onu ekrandan
// ayrı ve ÖLÇÜLEBİLİR tutar — ekran testi yok, saf fonksiyonun bekçisi var.
//
// `null` dönmesi "bu hata o dal değil" demektir ve çağıran Toast'a düşer: boş
// listeyle dialog açmak operatöre bilgi vermeyen bir pencere gösterirdi.
// =============================================================================

/** Backend `AppError.details` payload'ının bu daldaki şekli. */
interface DownstreamDetails {
  code?: string;
  blocked?: unknown;
}

/** Engelin bu dal olduğunu söyleyen kod — başka kodlar Toast yolunda kalır. */
export const SWATCHES_DOWNSTREAM_CODE = 'SWATCHES_DOWNSTREAM';

/**
 * Hata nesnesinden engelleyen kartela numaralarını çıkarır.
 * Dönen değer `null` ise dal bu değildir ya da listelenecek künye yoktur.
 */
export function blockedSwatchCardNumbers(err: unknown): string[] | null {
  const details = (err as { details?: DownstreamDetails } | null)?.details;
  if (!details || details.code !== SWATCHES_DOWNSTREAM_CODE) return null;
  if (!Array.isArray(details.blocked)) return null;
  // Künye olmayan öğe atılır: `undefined`ı "(kartela)" diye basmak uydurmaktır.
  const cards = details.blocked.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  return cards.length > 0 ? cards : null;
}
