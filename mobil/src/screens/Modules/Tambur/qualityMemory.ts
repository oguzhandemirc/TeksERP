// Tambur kalite düğmesi yardımcıları (saha 2026-11-10): son basılan kalite hatırlanır, düğmede yalnız kısa ad görünür.
// Kayda/etikete giden değer (kod + katalog adı) değişmez; bunlar yalnız düğme yüzeyini besler.

/** Düğme metni: sondaki " (…)" açıklaması gösterilmez ("A1 (Alt Kalite)" → "A1"); yalnız parantezse ad olduğu gibi kalır. */
export function shortGradeLabel(name: string): string {
  const short = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return short || name.trim();
}

/** Hatırlanan kod katalogda hâlâ varsa o kalite; yoksa (silinmiş/pasif/boş) null → ekran seçimsiz kalır. */
export function rememberedGrade<T extends { code: string }>(code: string | null | undefined, grades: readonly T[]): T | null {
  if (!code) return null;
  return grades.find((g) => g.code === code) ?? null;
}
