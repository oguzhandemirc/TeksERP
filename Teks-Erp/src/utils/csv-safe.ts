// CSV hücresi — formül enjeksiyonu seddi + tırnaklama (tek boğaz; Electron ikizi `src/lib/list-export.ts` csvCell).
// Excel/LibreOffice `= + - @ TAB CR` ile başlayan hücreyi tırnak içinde de formül sayar; METİN hücreye `'`
// öneki konur. Sayı hücresi önek ALMAZ (negatif sayı bozulmasın) — çağıran `csvNumberCell`i seçer.

const FORMULA_LEAD = /^[=+\-@\t\r]/;

function quote(s: string, sep: string): string {
  const needs = s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r") || s !== s.trim();
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Metin hücresi: formül önekli değer `'` alır, sonra gerekiyorsa tırnaklanır. */
export function csvTextCell(value: unknown, sep = ";"): string {
  const s = value === null || value === undefined ? "" : String(value);
  return quote(FORMULA_LEAD.test(s) ? `'${s}` : s, sep);
}

/** Sayı hücresi: önek YOK (`-12,5` sayı kalır); yalnız tırnaklama. */
export function csvNumberCell(value: number | string, sep = ";"): string {
  return quote(String(value), sep);
}
