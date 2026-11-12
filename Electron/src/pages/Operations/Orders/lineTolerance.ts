// Sipariş satırı tolerans % (K4) — form metni ↔ gövde değeri TEK kaynak (şema, satır kutusu, gövde aynı fonksiyonu okur).
// Sunucu sözleşmesi: 0..50, en çok 2 ondalık, ayırıcı NOKTA; boş = fabrika ayarı (null). Virgül burada noktaya çevrilir.

export const TOLERANCE_MAX = 50;

/** Form metni → gövde değeri ("1,5" → "1.5", boş → null) ya da Türkçe hata. */
export function parseTolerancePct(text: string | null | undefined): { value: string | null; error: string | null } {
  const t = (text ?? "").trim().replace(",", ".");
  if (t === "") return { value: null, error: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { value: null, error: "Tolerans % sayı olmalı (en çok 2 ondalık)" };
  if (Number(t) > TOLERANCE_MAX) return { value: null, error: `Tolerans % 0 ile ${TOLERANCE_MAX} arasında olmalı` };
  return { value: t, error: null };
}

/** Sunucu değeri (Decimal sayı ya da metin) → form metni; yok → "". */
export function toleranceToFormText(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "";
  return typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v;
}
