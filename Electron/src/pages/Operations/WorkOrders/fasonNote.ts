/**
 * Fason adımının notu = o adımın talimatı (boya/şardon/vs). Etiket istasyon adına
 * göre dinamik: "Boyahane Talimatı", "Şardon Talimatı"… İstasyon henüz seçilmemişse
 * (yeni adım) "Fason Talimatı" fallback'i. WO global "Boyahane Notu" kaldırıldı —
 * her fason adımının kendi notu tek kaynak.
 */
export function fasonNoteLabel(stationName?: string | null): string {
  const name = stationName?.trim();
  return name ? `${name} Talimatı` : "Fason Talimatı";
}
