// =============================================================================
// FASON SEVK KALEMİ DARALTMASI — kalem polimorfik (F1: ROLL | WARP_BEAM); top-yalnız
// yollar (kabul · parti cerrahisi · doğrudan sevk · aktarım geri alma · önizlemeler)
// bu iki daraltmadan geçer, `rollId!` / `roll!` yazılmaz.
// =============================================================================

/** Top kalemi — `rollId` dolu (CHECK `kind_ref_ck`: ROLL ⇔ rollId). */
export function isRollItem<T extends { rollId: string | null }>(i: T): i is T & { rollId: string } {
  return i.rollId !== null;
}

/** Top kalemi, ilişki yüklü — `roll` dolu. */
export function hasRoll<T extends { roll: unknown }>(i: T): i is T & { roll: NonNullable<T["roll"]> } {
  return i.roll != null;
}
