// Etiket kâğıdının ölçülen alana sığma ölçeği (px/mm): hem genişliğe hem yüksekliğe sığar, oran korunur.
// Geniş kesim sol sütunu kaydırmasızdır (2026-11-11) — kâğıt alanı taşmamalı, ölçek bu yüzden iki sınırın küçüğü.
export function fitPaperScale(availW: number, availH: number, paperWmm: number, paperHmm: number): number {
  if (!(availW > 0) || !(availH > 0) || !(paperWmm > 0) || !(paperHmm > 0)) return 0;
  return Math.min(availW / paperWmm, availH / paperHmm);
}
