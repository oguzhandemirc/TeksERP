// D3a (2026-10-28): tablo/ızgara başlık etiketi eşlemesi — tek yardımcı (anchor.ts'in n-gram penceresi satır-içi
// etiketler içindir; tablo başlıkları ayrı kutudur, bütün satır metni etiketle karşılaştırılır).
import type { OcrLine, OcrRect } from "./types";
import { normalizeForMatch, similarity } from "./text-normalize";
import { centerX } from "./geometry";

export const LABEL_MIN_SIMILARITY = 0.8;

/** Satır metninin etiket listesine en iyi benzerliği (0..1). Tam içerme (kelime sınırlı) 1 sayılır. */
export function labelSimilarity(text: string, labels: string[]): number {
  const norm = normalizeForMatch(text);
  if (!norm) return 0;
  let best = 0;
  for (const label of labels) {
    const ln = normalizeForMatch(label);
    if (!ln) continue;
    if (norm === ln) return 1;
    // Kelime-sınırlı içerme yalnız kısa satırda ("TOPLAM METRE" ⊃ "TOPLAM"); uzun hücre metni ("P2008….TOPLAM.KG") etiket değildir
    const words = norm.split(" ").length;
    if (words <= ln.split(" ").length + 1 && (" " + norm + " ").includes(" " + ln + " ")) best = Math.max(best, 0.95);
    best = Math.max(best, similarity(norm, ln));
  }
  return best;
}

/**
 * Satır yazısının etiket kısmı: rakamlı kelime (değer) atılır, yapışık "No:123" → "No", baş/son noktalama silinir.
 * Panel + tablet `tanit/teachDraft.ts` `identifierText` bu ifadenin aynasıdır (bekçi `test_gelen_belge_motor` §12i).
 */
export const identifierText = (text: string): string =>
  text.split(/\s+/).map((x) => (/\d/.test(x) ? (/^[^\d:]+:/.exec(x)?.[0] ?? "") : x)).filter(Boolean).join(" ").replace(/^[\s:.,;|/#–-]+|[\s:.,;|/#–-]+$/gu, "");

/** Toplam satırı etiketi: dokunulan kutudaki adet atılır ("T.Adet 5" · yapışık "T.Adet16" → "T.Adet"); kısa etiket tam kalır. */
export function totalsLabelOf(text: string): string {
  return sectionStartLabel(text.trim().replace(/([\p{L}.])\d{1,4}$/u, "$1"));
}

/** Bölüm başlangıç etiketi: etiket kısmı ≥3 harfse o, değilse tam metin ("No: 12" kısa etiketi değeriyle kalır; yanlış pozitif yok). */
export function sectionStartLabel(text: string): string {
  const part = identifierText(text);
  return (part.match(/\p{L}/gu)?.length ?? 0) >= 3 ? part : text.trim();
}

export function matchesLabel(text: string, labels: string[], min = LABEL_MIN_SIMILARITY): boolean {
  return labelSimilarity(text, labels) >= min;
}

/** İki kutunun yatay çakışması (piksel; yoksa ≤ 0). */
export function overlapX(a: OcrRect, b: OcrRect): number {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
}

/** Kutu, kolon başlığı kutularından hangisine düşer: en büyük yatay çakışma; çakışma yoksa merkez uzaklığı ≤ tolerans. */
export function assignToColumn(rect: OcrRect, columns: Array<{ key: string; rect: OcrRect }>, tolerance: number): string | null {
  let best: string | null = null;
  let bestOverlap = 0;
  for (const c of columns) {
    const o = overlapX(rect, c.rect);
    if (o > bestOverlap) {
      bestOverlap = o;
      best = c.key;
    }
  }
  if (best) return best;
  let bestDist = Infinity;
  for (const c of columns) {
    const d = Math.abs(centerX(rect) - centerX(c.rect));
    if (d < bestDist && d <= tolerance) {
      bestDist = d;
      best = c.key;
    }
  }
  return best;
}

/** Satır metni sayısal mı ("26209936", "141,70", "241,00 MT")? */
export function isNumericText(text: string): boolean {
  return /^\s*[-+]?\d[\d.,]*\s*(?:[a-zçğıöşü²\/.]{0,5})?\s*$/i.test(text);
}

export function lineCenterInside(line: OcrLine, rect: OcrRect): boolean {
  const cx = centerX(line.rect);
  const cy = line.rect.y + line.rect.height / 2;
  return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
}
