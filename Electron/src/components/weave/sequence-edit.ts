// Kutu şeridi düzenleyicisinin SAF dönüşümleri: sıra kodu ("A2 B1" atkı · "2A 1B" çözgü) ↔ koşu listesi ↔
// kutu dizisi (kutu başına 1-tabanlı harf no). Yalnız DÜZENLEME TASLAĞI içindir: kaydedilen değer metindir,
// kayıtlı görünümün açılımı (pickSequence / endsSequence) sunucudan gelir — dokuma.md.

export interface Run { letter: number; count: number }
/** "letter-first" = A2 B1 (atkı kartı biçimi, sunucu yalnız bunu kabul eder) · "digit-first" = 2A 1B. */
export type CodeStyle = "letter-first" | "digit-first";

/** Şerit tavanı: bunun üstündeki kod şeritte düzenlenmez (metin alanı kalır). */
export const SEQUENCE_EDIT_MAX = 512;

const DIGIT_FIRST = /^(\d{1,4}[A-Z])+$/;
const LETTER_FIRST = /^([A-Z]\d{1,4})+$/;
const LETTERS_ONLY = /^[A-Z]+$/;

/** `repeated`: kodda tekrar kısaltması vardı, koşular AÇILMIŞ hâldedir (şeritten düzenleme kısaltmayı açar). */
export interface ParsedCode { runs: Run[]; style: CodeStyle; repeated?: true }

/** Tekrar açılımının üst sınırı: sunucu tavanlarının (atkı 512, çözgü 2000) üstü zaten geçersizdir. */
const REPEAT_EXPAND_MAX = 4096;
const GROUP = /(\d{1,4})\s*[X*]\s*\(([^()]*)\)|\(([^()]*)\)\s*[X*]\s*(\d{1,4})/g;

interface RepeatPart { text: string; times: number; group: boolean }

/** Sunucu `sequence-repeat.helper` aynası: "10x(…)", "(…)x10", "10*(…)"; iç içe/kapanmayan parantez null. */
function splitRepeatGroups(upper: string): RepeatPart[] | null {
  let depth = 0;
  for (const ch of upper) {
    if (ch === "(" && ++depth > 1) return null;
    if (ch === ")" && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  const parts: RepeatPart[] = [];
  let last = 0;
  for (const m of upper.matchAll(GROUP)) {
    if (m.index > last) parts.push({ text: upper.slice(last, m.index), times: 1, group: false });
    const times = Number(m[1] ?? m[4]);
    const text = (m[2] ?? m[3])!;
    if (times <= 0 || text.trim() === "") return null;
    parts.push({ text, times, group: true });
    last = m.index + m[0].length;
  }
  if (last < upper.length) parts.push({ text: upper.slice(last), times: 1, group: false });
  return parts.some((p) => !p.group && /[()]/.test(p.text)) ? null : parts;
}

/** Tek parçayı (parantezsiz) koşulara böler; `style` null = yalnız harf (biçim belirsiz). */
function parseFlat(s: string): { runs: Run[]; style: CodeStyle | null } | null {
  const runs: Run[] = [];
  let style: CodeStyle | null = null;
  if (LETTERS_ONLY.test(s)) {
    for (const ch of s) runs.push({ letter: ch.charCodeAt(0) - 64, count: 1 });
  } else if (DIGIT_FIRST.test(s)) {
    style = "digit-first";
    for (const m of s.matchAll(/(\d{1,4})([A-Z])/g)) runs.push({ letter: m[2]!.charCodeAt(0) - 64, count: Number(m[1]) });
  } else if (LETTER_FIRST.test(s)) {
    style = "letter-first";
    for (const m of s.matchAll(/([A-Z])(\d{1,4})/g)) runs.push({ letter: m[1]!.charCodeAt(0) - 64, count: Number(m[2]) });
  } else {
    return null;
  }
  return runs.every((r) => r.count > 0) ? { runs, style } : null;
}

/**
 * Kodu koşulara böler. "A2 B1", "2A 1B", "1 A 1 B", "ABAB" ve tekrar kısaltması "10x(A2 B2 C1) D4" okunur;
 * boş → boş liste; okunamayan → null. Ayırıcılar (boşluk , ; + · / -) yok sayılır — sunucu
 * `warp-sequence.helper` / `weft-sequence.helper` ile aynı okuma.
 */
export function parseSequenceCode(raw: string | null | undefined): ParsedCode | null {
  const parts = splitRepeatGroups((raw ?? "").toUpperCase());
  if (!parts) return null;
  const runs: Run[] = [];
  let style: CodeStyle | null = null;
  let repeated = false;
  let total = 0;
  for (const p of parts) {
    const s = p.text.replace(/[\s,;+·/-]+/g, "");
    if (s.length === 0) continue;
    const flat = parseFlat(s);
    if (!flat) return null;
    style ??= flat.style;
    if (p.group) repeated = true;
    total += flat.runs.reduce((n, r) => n + r.count, 0) * p.times;
    if (repeated && total > REPEAT_EXPAND_MAX) return null;
    for (let k = 0; k < p.times; k++) runs.push(...flat.runs.map((r) => ({ ...r })));
  }
  const out: ParsedCode = { runs, style: style ?? "letter-first" };
  if (repeated) out.repeated = true;
  return out;
}

const letterOf = (n: number) => String.fromCharCode(64 + n);

/** Koşuları koda yazar (ardışık aynı harf birleştirilmez — kullanıcının yazdığı bölünme korunur). */
export function formatRuns(runs: readonly Run[], style: CodeStyle): string {
  return runs.map((r) => (style === "digit-first" ? `${r.count}${letterOf(r.letter)}` : `${letterOf(r.letter)}${r.count}`)).join(" ");
}

/** Koşuları kutulara açar; tavanı aşarsa null (şerit düzenlemesi kapanır). */
export function runsToBoxes(runs: readonly Run[], max = SEQUENCE_EDIT_MAX): number[] | null {
  const out: number[] = [];
  for (const r of runs) {
    if (out.length + r.count > max) return null;
    for (let i = 0; i < r.count; i++) out.push(r.letter);
  }
  return out;
}

/** Kutuları koşulara toplar (ardışık aynı harf tek koşu). */
export function boxesToRuns(boxes: readonly number[]): Run[] {
  const out: Run[] = [];
  for (const b of boxes) {
    const last = out.at(-1);
    if (last && last.letter === b) last.count += 1;
    else out.push({ letter: b, count: 1 });
  }
  return out;
}

/** Kutu dizisini koda çevirir (şeritten düzenlenen sıra metne yazılırken). */
export const boxesToCode = (boxes: readonly number[], style: CodeStyle): string => formatRuns(boxesToRuns(boxes), style);

/** i. kutunun harfini değiştirir. */
export function setBox(boxes: readonly number[], i: number, letter: number): number[] {
  if (i < 0 || i >= boxes.length || boxes[i] === letter) return boxes.slice();
  const out = boxes.slice();
  out[i] = letter;
  return out;
}

/** Harfi döngüsel sonraki harfe çevirir (A → B → … → son → A); tıkla-değiştir. */
export function cycleBox(boxes: readonly number[], i: number, letterCount: number): number[] {
  const cur = boxes[i];
  if (cur === undefined || letterCount <= 0) return boxes.slice();
  return setBox(boxes, i, (cur % letterCount) + 1);
}

/** `at` konumuna (o kutunun önüne) kutu ekler; tavanda eklemez. */
export function insertBox(boxes: readonly number[], at: number, letter: number, max = SEQUENCE_EDIT_MAX): number[] {
  if (boxes.length >= max) return boxes.slice();
  const pos = Math.max(0, Math.min(at, boxes.length));
  return [...boxes.slice(0, pos), letter, ...boxes.slice(pos)];
}

export function removeBox(boxes: readonly number[], i: number): number[] {
  return i < 0 || i >= boxes.length ? boxes.slice() : [...boxes.slice(0, i), ...boxes.slice(i + 1)];
}

/** Kodda kartta olmayan harf var mı (1-tabanlı en büyük harf > satır sayısı) ya da kullanılmayan harf. */
export function letterCoverage(boxes: readonly number[], letterCount: number): { unknown: number[]; missing: number[] } {
  const used = new Set(boxes);
  const unknown = [...used].filter((l) => l > letterCount).sort((a, b) => a - b);
  const missing = Array.from({ length: Math.max(0, letterCount) }, (_, i) => i + 1).filter((l) => !used.has(l));
  return { unknown, missing };
}
