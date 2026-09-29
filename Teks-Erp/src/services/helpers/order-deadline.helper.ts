// =============================================================================
// SİPARİŞ TERMİN GECİKMESİ — TEK KAYNAK
// =============================================================================
// "Termini geçti mi, kaç gün" sorusu iki AN arasındaki farktır (takvim günü sorusu
// değil; fabrika saat diliminden bağımsız). Açık sipariş karşılama raporu ile patron
// bulutu projeksiyonu (`cloud-sync` · `gecikmis`) aynı cevabı vermek zorunda.
// =============================================================================

const DAY_MS = 86_400_000;

/** Termin geçmişse geçen TAM gün sayısı (0 = bugün geçti), geçmemişse ya da termin yoksa `null`. */
export function daysPastDeadline(deadline: Date | null | undefined, nowMs: number): number | null {
  // tz-ok: mutlak an farkı.
  if (!deadline || deadline.getTime() >= nowMs) return null;
  return Math.floor((nowMs - deadline.getTime()) / DAY_MS);
}
