/**
 * Metraj gösterimi — TEK biçim: Türkçe binlik ayracı, en fazla 2 ondalık ("4.521", "2.915,5").
 * Depo "2915.0 m", Kurşun Dağıtım "4.521 m" yazıyordu (QA 2026-11-03).
 */
export function fmtMeters(m: number): string {
  return m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}
