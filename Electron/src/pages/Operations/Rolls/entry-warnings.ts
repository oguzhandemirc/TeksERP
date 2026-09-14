// =============================================================================
// TOP GİRİŞİ UYARILARI — sunucu `ApiResponse.warnings`ı OLDUĞU GİBİ (saf; Devere Faz 4 levent tüketimi)
// =============================================================================
/** Boş/boşluk satırlar düşer; metin YENİDEN YAZILMAZ — tek gerçeğin tek yazımı (sunucu). */
export function entryWarnings(res: { warnings?: readonly string[] } | null | undefined): string[] {
  return (res?.warnings ?? []).map((w) => w.trim()).filter((w) => w.length > 0);
}
