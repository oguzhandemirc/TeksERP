// =============================================================================
// HİZMET KALEMİ SEÇİM SIRASI — tek kaynak (Gülkesim dalga 4 · D4-D3, DALGA4 §5.5/8)
// =============================================================================
// Soru: "bu işe hangi hizmet kalemi kesilir?" Sıra: çeşit DEĞERİNİN kalemi (gramaj kademesi,
// brode deseni) → özelliğin kalemi → ana bayrağın kalemi. Kurşun (`loadValueServiceMap`) ve
// bayrak işleri (`listFlagServiceWorks`) aynı sırayı buradan alır; `test_desen_fatura_kalemi`
// AST taraması `.serviceItemId ?? <ifade>` zincirini başka dosyada kırmızı yapar.
// =============================================================================

/** İlk dolu kalem: değer → özellik → ana bayrak; hiçbiri yoksa null (iş eşlemesizdir). */
export function pickServiceItemId(src: {
  value?: string | null;
  property?: string | null;
  parentFlag?: string | null;
}): string | null {
  return src.value ?? src.property ?? src.parentFlag ?? null;
}
