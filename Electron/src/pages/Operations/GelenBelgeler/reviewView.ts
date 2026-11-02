// Gözden geçirme yüzeyi (saf, yalnız GÖSTERİM): sorun ve toplam hükmü backend'den gelir (`problems`, `totalsCheck`
// — onay ön kontrolüyle aynı yüklem); burada kural yok, yalnız süzme ve Türkçe metin.
import type { BlockCheck, LineProblem, TotalDiff } from "./reviewTypes";

export const PROBLEM_LABEL: Record<LineProblem, string> = {
  FAILED: "Girilemedi",
  ITEM_UNRESOLVED: "Ürün seçilmedi",
  NEEDS_REVIEW: "Gözden geçirilmedi",
};

type ProblemLine = { problems?: readonly LineProblem[] };

export const hasProblem = (l: ProblemLine): boolean => (l.problems?.length ?? 0) > 0;

/** Süzgeç açıkken yalnız sorunlu satırlar; sayaç "gösterilen / toplam". */
export function visibleLines<T extends ProblemLine>(lines: readonly T[], onlyProblems: boolean): { rows: T[]; problemCount: number; total: number } {
  const problemRows = lines.filter(hasProblem);
  return { rows: onlyProblems ? problemRows : [...lines], problemCount: problemRows.length, total: lines.length };
}

const qty = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${qty(Math.abs(n))}`;
const FIELD: Record<TotalDiff["field"], { label: string; unit: string }> = {
  count: { label: "Top", unit: " top" },
  m: { label: "Metre", unit: " m" },
  kg: { label: "Kilo", unit: " kg" },
};

/** "Metre: beyan 819,2 m, satırlar 815 m (fark −4,2 m)" — okunamayan beyanda farksız. */
export function describeDiff(d: TotalDiff): string {
  const f = FIELD[d.field];
  if (d.declared === null || d.diff === null) return `${f.label}: beyan okunamadı, satırlar ${qty(d.actual)}${f.unit}`;
  return `${f.label}: beyan ${qty(d.declared)}${f.unit}, satırlar ${qty(d.actual)}${f.unit} (fark ${signed(d.diff)}${f.unit})`;
}

export function blockSummary(b: BlockCheck): string {
  return `${b.lines.count} top · ${qty(b.lines.m)} m${b.lines.kg > 0 ? ` · ${qty(b.lines.kg)} kg` : ""}`;
}
