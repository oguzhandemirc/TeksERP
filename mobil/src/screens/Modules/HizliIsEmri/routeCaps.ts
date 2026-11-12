// Rota hedef renk / özellik uygulayabilir mi (SAF; hafif dosya): Hızlı İE kancası ve tablet İE formu aynı yüklemi kullanır.
export type RouteLike = {
  steps?: {
    station?: {
      appliesColor?: boolean;
      appliesProperty?: boolean;
      defaultCategory?: { id: string; appliesColor?: boolean; appliesProperty?: boolean } | null;
    } | null;
  }[];
} | null;

/**
 * Rota hedef renk / özellik uygulayabilir mi + fason kategorileri hangileri.
 *
 * ⚠️ 2026-08-10: İSTASYONUN KENDİ bayrakları da okunur. Eskiden yalnız fason
 * kategorisine bakılıyordu — backend guard'ı da öyleydi; ikisi birlikte
 * değişti. Renk/özellik uygulayan bir İÇ istasyon içeren rota, eski hâlde
 * "uygulayamaz" görünüp ekranda alanı gizlerdi (backend kabul etse bile).
 *
 * Eski backend `appliesColor` göndermez → `undefined` → eski davranış (yalnız
 * kategori) sürer. Yani bu değişiklik APK'yı ZORUNLU kılmaz.
 */
export function routeApplyCaps(route: RouteLike) {
  const ids = new Set<string>();
  let color = false;
  let props = false;
  for (const s of route?.steps ?? []) {
    const st = s.station;
    if (!st) continue;
    if (st.appliesColor) color = true;
    if (st.appliesProperty) props = true;
    const cat = st.defaultCategory;
    if (!cat) continue;
    ids.add(cat.id);
    if (cat.appliesColor) color = true;
    if (cat.appliesProperty) props = true;
  }
  return { fasonCategoryIds: [...ids], canApplyColor: color, canApplyProps: props };
}
