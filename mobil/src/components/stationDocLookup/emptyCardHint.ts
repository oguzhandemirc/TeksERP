/**
 * Kurşun/Tambur "Kart açılmadı" boş durum ipucu — profil-bağımsız (QA 2026-11-03):
 * refakat kartı kullanmayan fabrikada (belge gezer) "refakat kartı" demez; belge
 * okutma açıksa onu da önerir.
 */
export function emptyCardHint(o: { compact: boolean; docLookupEnabled: boolean; where: string }): string {
  if (o.compact) return 'Üstten "Açık İşler" butonuyla kart okutarak başlayın';
  return o.docLookupEnabled
    ? `${o.where} kart ya da belge okutarak başlayın`
    : `${o.where} kart okutarak başlayın`;
}
