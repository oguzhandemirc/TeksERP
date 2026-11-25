// =============================================================================
// Çözgü dizilimi (`WarpSpec.sequenceNote`, ör. "2A 1B") → tel düzeni (kart görseli, 2026-11-22)
// =============================================================================
// Not serbest metindir ve hesaba GİRMEZ; burası yalnız GÖSTERİM içindir (tel düzeni şeridi, tarak
// planı). İstemci açılımı yeniden hesaplamaz — sonuç DTO'da `endsSequence` olarak gider. Okunamayan
// not null döner (ekran oransal bloğa düşer). SAF. Tekrar kısaltması "5x(2A 1B) 4C" de okunur.
// =============================================================================
import { splitRepeatGroups } from "./sequence-repeat.helper";

/** Bir raporun tel sayısı tavanı — üstü gösterim için anlamsız, null döner. */
export const WARP_SEQUENCE_MAX_REPEAT = 2000;

export interface WarpEndsSequence {
  /** Bir raporun tel tel açılımı: 1-tabanlı iplik satırı no (A = 1). */
  repeat: number[];
  /** Toplam telde tam rapor adedi. */
  repeatCount: number;
  /** Son yarım raporun tel sayısı (raporun başından sayılır). */
  remainder: number;
  /** Toplam tel (Σ iplik satırı). */
  totalEnds: number;
  /** Açılım toplam tele yayılınca her ipliğin teli kart satırıyla aynı mı (değilse ekran uyarır). */
  matchesYarnEnds: boolean;
}

const DIGIT_FIRST = /^(\d{1,4}[A-Z])+$/;
const LETTER_FIRST = /^([A-Z]\d{1,4})+$/;
const LETTERS_ONLY = /^[A-Z]+$/;

/** Notu (harf, adet) çiftlerine böler; "2A 1B", "A2 B1", "1 A 1 B", "ABAB" okunur, gerisi null. */
function tokenize(note: string): Array<{ letter: number; count: number }> | null {
  const s = note.toUpperCase().replace(/[\s,;+·/-]+/g, "");
  if (s.length === 0) return null;
  const out: Array<{ letter: number; count: number }> = [];
  if (LETTERS_ONLY.test(s)) {
    for (const ch of s) out.push({ letter: ch.charCodeAt(0) - 64, count: 1 });
  } else if (DIGIT_FIRST.test(s)) {
    for (const m of s.matchAll(/(\d{1,4})([A-Z])/g)) out.push({ letter: m[2]!.charCodeAt(0) - 64, count: Number(m[1]) });
  } else if (LETTER_FIRST.test(s)) {
    for (const m of s.matchAll(/([A-Z])(\d{1,4})/g)) out.push({ letter: m[1]!.charCodeAt(0) - 64, count: Number(m[2]) });
  } else {
    return null;
  }
  return out.every((t) => t.count > 0) ? out : null;
}

/** Tekrar kısaltmalı not ("5x(2A 1B) 4C"): parça başına çiftler + tekrar sayısı; parantez hatası ya da okunamayan parça null. */
function tokenizeWithRepeats(note: string): Array<{ tokens: Array<{ letter: number; count: number }>; times: number }> | null {
  const split = splitRepeatGroups(note.toUpperCase());
  if (!split.ok) return null;
  const out: Array<{ tokens: Array<{ letter: number; count: number }>; times: number }> = [];
  for (const p of split.parts) {
    if (!p.group && p.text.replace(/[\s,;+·/-]+/g, "") === "") continue;
    const tokens = tokenize(p.text);
    if (!tokens) return null;
    out.push({ tokens, times: p.times });
  }
  return out.length > 0 ? out : null;
}

/**
 * Dizilim notunu tel tel açar. `endsByLetter[i]` = (i+1). harfin (A = 0) toplam teli, sıra kart satırı
 * sırasıdır. Not boş/okunamaz, kartta olmayan harf ya da rapor tavanı aşılırsa null.
 * Örn. "2A 1B", [2334, 1166] → repeat [1,1,2], 1166 rapor + 2 tel artık.
 */
export function expandWarpSequence(
  note: string | null | undefined,
  endsByLetter: readonly number[],
  maxRepeat: number = WARP_SEQUENCE_MAX_REPEAT,
): WarpEndsSequence | null {
  if (!note || endsByLetter.length === 0) return null;
  const parts = tokenizeWithRepeats(note);
  if (!parts) return null;
  const repeat: number[] = [];
  for (const p of parts) {
    let partEnds = 0;
    for (const t of p.tokens) {
      if (t.letter > endsByLetter.length) return null;
      partEnds += t.count;
    }
    if (repeat.length + partEnds * p.times > maxRepeat) return null;
    for (let k = 0; k < p.times; k++) {
      for (const t of p.tokens) for (let i = 0; i < t.count; i++) repeat.push(t.letter);
    }
  }
  const totalEnds = endsByLetter.reduce((s, n) => s + Math.max(0, n), 0);
  const repeatCount = Math.floor(totalEnds / repeat.length);
  const remainder = totalEnds % repeat.length;
  const perLetter = new Array<number>(endsByLetter.length).fill(0);
  repeat.forEach((l, i) => { perLetter[l - 1] = perLetter[l - 1]! + repeatCount + (i < remainder ? 1 : 0); });
  const matchesYarnEnds = perLetter.every((n, i) => n === endsByLetter[i]);
  return { repeat, repeatCount, remainder, totalEnds, matchesYarnEnds };
}

/** Tablet tel düzeni bandı yükü: kart satırları (harf = sıra) + dizilim notu + açılım — tablet hesaplamaz. */
export interface TabletWarpLayout {
  yarns: Array<{ letter: string; code: string; name: string; endsCount: number }>;
  sequenceNote: string | null;
  endsSequence: WarpEndsSequence | null;
}

/** Sıralı kart satırlarından tablet bandı yükü (devere bağlamı ve devere kabul bağlamı aynı biçim). */
export function tabletWarpLayout(
  lines: ReadonlyArray<{ endsCount: number; yarnItem: { code: string; name: string } }>,
  sequenceNote: string | null,
): TabletWarpLayout {
  const yarns = lines.map((l, i) => ({ letter: String.fromCharCode(65 + i), code: l.yarnItem.code, name: l.yarnItem.name, endsCount: l.endsCount }));
  return { yarns, sequenceNote, endsSequence: expandWarpSequence(sequenceNote, lines.map((l) => l.endsCount)) };
}
