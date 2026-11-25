// Satır eni ön-dolumu (sipariş · teklif): ürün seçilince kartın mamul eni (`Item.widthCm`) satıra gelir.
// Elle yazılmış en ezilmez; yalnız boş alan ya da bir önceki seçimin ön-doldurduğu değer yenilenir. Kayıtlı
// eski satır yüklenirken hiçbir şey doldurulmaz — ön-dolum yalnız seçim olayında çağrılır.

/** Kart eni (Decimal metin/sayı) → pozitif sayı; boş/bozuk/sıfır → null. */
export function itemWidthOf(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Yeni seçimden sonra satırın eni.
 * @param current satırdaki en (boş = null)
 * @param prevAuto bir önceki seçimin ön-doldurduğu en (bilinmiyorsa null — o zaman yalnız boş alan dolar)
 * @param next yeni kartın eni
 */
export function prefillWidth(current: number | null | undefined, prevAuto: number | null, next: number | null): number | null {
  const cur = current ?? null;
  const untouched = cur === null || (prevAuto !== null && cur === prevAuto);
  return untouched ? next : cur;
}

/** Metin alanlı formlar (teklif) için aynı kural: boş metin = boş en. */
export function prefillWidthText(current: string, prevAuto: number | null, next: number | null): string {
  const cur = itemWidthOf(current.trim() === "" ? null : current);
  if (current.trim() !== "" && cur === null) return current; // okunamayan elle yazım — dokunma
  const out = prefillWidth(cur, prevAuto, next);
  return out === cur && current.trim() !== "" ? current : out === null ? "" : String(out);
}
