// =============================================================================
// KK1 KAYIT UYARILARI — sunucu `ApiResponse.warnings`ı OLDUĞU GİBİ operatöre (saf, React'sız)
// =============================================================================
// Devere Faz 4: tezgahtan inen top kaydında levent tüketimi uyarıları (take-up yok · kalan yetmedi ·
// kalan 0 · bağlı levent yoktu) sunucudan gelir; metin YENİDEN YAZILMAZ (tek gerçeğin tek yazımı),
// birleştirilerek basılır. Uyarı başarıyı bozmaz — kayıt oldu, operatör bilsin.
// =============================================================================
export interface EntryWarningToast {
  text1: string;
  text2: string;
}

export function buildEntryWarningToast(warnings: readonly string[] | undefined, barcode: string | null | undefined, current: boolean): EntryWarningToast | null {
  const list = (warnings ?? []).map((w) => w.trim()).filter((w) => w.length > 0);
  if (list.length === 0) return null;
  const kim = barcode ? `${barcode} — ` : '';
  return { text1: current ? `Kaydedildi ✓ — ${kim}uyarı` : `${kim}levent uyarısı`, text2: list.join(' · ') };
}
