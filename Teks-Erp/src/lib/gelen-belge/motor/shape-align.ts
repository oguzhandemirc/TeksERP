// Kaynak: ocr-test prototipi src/ocr-engine/normalizers.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Boyut kuralı (max-lines 300) için normalizers.ts'ten AYRILDI: karışıklık tabloları + pattern şekil hizalama.
/**
 * Pattern'e göre konumsal düzeltme (alnum/code): OCR karışıklıklarını (O↔0, I↔1, S↔5, B↔8, Z↔2, G↔6, D→0)
 * sabit şekilli bir pattern'e en düşük maliyetle hizalayarak düzeltir.
 */
import { collapseSpaces, stripDiacritics, trimPunct, turkishUpper } from "./text-normalize";

/** Harf → rakam karışıklık tablosu (yalnız sayısal bağlamda). */
export const LETTER_TO_DIGIT: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", "|": "1", i: "1", "!": "1",
  S: "5", s: "5",
  B: "8",
  Z: "2", z: "2",
  G: "6",
};
/** Rakam → harf karışıklık tablosu (yalnız harf bağlamında). */
export const DIGIT_TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };


// ---------------------------------------------------------------------------
// Pattern'e göre konumsal düzeltme (alnum/code)
// ---------------------------------------------------------------------------

interface Slot {
  kind: 'class' | 'literal';
  test: (ch: string) => boolean;
  /** Karışıklık tablosuna göre dönüştürme; mümkün değilse null. */
  convert: (ch: string) => string | null;
  literal?: string;
  optional: boolean;
}

const isDigit = (c: string) => c >= '0' && c <= '9';
const isUpper = (c: string) => c >= 'A' && c <= 'Z';

function classSlot(kind: 'digit' | 'upper' | 'alnum', optional: boolean): Slot {
  if (kind === 'digit') {
    return { kind: 'class', optional, test: isDigit, convert: (c) => LETTER_TO_DIGIT[c] ?? null };
  }
  if (kind === 'upper') {
    return {
      kind: 'class',
      optional,
      test: isUpper,
      convert: (c) => {
        if (DIGIT_TO_LETTER[c]) return DIGIT_TO_LETTER[c];
        const folded = stripDiacritics(c);
        return isUpper(folded) ? folded : null;
      },
    };
  }
  return {
    kind: 'class',
    optional,
    test: (c) => isDigit(c) || isUpper(c),
    convert: (c) => {
      const folded = stripDiacritics(c);
      return isUpper(folded) ? folded : null;
    },
  };
}

/**
 * Pattern'i slot dizisine ayrıştırır. Yalnız şu alt küme desteklenir:
 * ^ $ literal \d [0-9] [A-Z] [A-Z0-9] [0-9A-Z] {n} {n,m} ve kaçışlı literal (\-, \. ...).
 * Desteklenmeyen bir yapı görülürse null döner (yalnız doğrulama yapılır).
 */
export function parseShapePattern(pattern: string): Slot[] | null {
  const slots: Slot[] = [];
  let i = 0;
  const p = pattern;
  const pushRepeated = (make: (opt: boolean) => Slot) => {
    // Sayaç var mı?
    const m = /^\{(\d+)(?:,(\d+))?\}/.exec(p.slice(i));
    if (m) {
      const min = parseInt(m[1], 10);
      const max = m[2] !== undefined ? parseInt(m[2], 10) : min;
      if (max < min || max - min > 10 || max > 64) throw new Error('unsupported');
      for (let k = 0; k < min; k++) slots.push(make(false));
      for (let k = min; k < max; k++) slots.push(make(true));
      i += m[0].length;
    } else slots.push(make(false));
  };
  try {
    while (i < p.length) {
      const ch = p[i];
      if (ch === '^' && i === 0) { i++; continue; }
      if (ch === '$' && i === p.length - 1) { i++; continue; }
      if (ch === '\\') {
        const next = p[i + 1];
        if (next === undefined) return null;
        i += 2;
        if (next === 'd') { pushRepeated((o) => classSlot('digit', o)); continue; }
        if (/[A-Za-z0-9]/.test(next)) return null; // \w \s vb. desteklenmiyor
        pushRepeated((o) => literalSlot(next, o));
        continue;
      }
      if (ch === '[') {
        const end = p.indexOf(']', i);
        if (end < 0) return null;
        const body = p.slice(i + 1, end);
        i = end + 1;
        if (body === '0-9') { pushRepeated((o) => classSlot('digit', o)); continue; }
        if (body === 'A-Z') { pushRepeated((o) => classSlot('upper', o)); continue; }
        if (body === 'A-Z0-9' || body === '0-9A-Z') { pushRepeated((o) => classSlot('alnum', o)); continue; }
        return null;
      }
      if ('.+*?()|{}'.includes(ch)) return null;
      i++;
      pushRepeated((o) => literalSlot(ch, o));
    }
  } catch {
    return null;
  }
  return slots;
}

function literalSlot(lit: string, optional: boolean): Slot {
  // Literal harf/rakam için de karışıklık tablosu geçerli ("IR5-" → "IRS-", "5P-" → "SP-")
  const convert = (c: string): string | null => {
    if (isUpper(lit) && DIGIT_TO_LETTER[c] === lit) return lit;
    if (isDigit(lit) && LETTER_TO_DIGIT[c] === lit) return lit;
    if (isUpper(lit) && stripDiacritics(c) === lit) return lit;
    return null;
  };
  return { kind: 'literal', optional, literal: lit, test: (c) => c === lit, convert };
}

const DIGIT_TO_LOWER: Record<string, string> = { '0': 'o', '1': 'l', '5': 's', '8': 'b', '2': 'z', '6': 'g' };

/**
 * Serbest metinde harf-sözcük içine sızmış rakamları harfe çevirir ("TRİK0" → "TRİKO", "As1an" → "Aslan").
 * Yalnız ≥2 harfli ve rakam sayısı harf sayısının yarısını aşmayan sözcüklerde; "40/1", "2x2" dokunulmaz.
 */
export function fixTextConfusions(s: string): { text: string; corrected: boolean } {
  let corrected = false;
  const text = s.replace(/\S+/g, (token) => {
    const letters = (token.match(/\p{L}/gu) ?? []).length;
    const digits = (token.match(/\d/g) ?? []).length;
    if (letters < 2 || digits === 0 || digits > letters / 2) return token;
    if (!/^[\p{L}\d.'-]+$/u.test(token)) return token;
    const upper = (token.match(/\p{Lu}/gu) ?? []).length >= letters / 2;
    let out = '';
    for (const ch of token) {
      const rep = isDigit(ch) ? (upper ? DIGIT_TO_LETTER[ch] : DIGIT_TO_LOWER[ch]) : undefined;
      if (rep) {
        out += rep;
        corrected = true;
      } else out += ch;
    }
    return out;
  });
  return { text, corrected };
}

const SEP_CHARS = new Set([' ', '-', '–', '—', '.', ',', ':', ';', '_', '/', '\\', '|', "'", '"', '·', '*']);

/**
 * Slot dizisine göre girdiyi en düşük maliyetle hizalar (DP). Maliyetler:
 * sınıf uyumu 0; karışıklık dönüşümü 1; eksik literal ekleme 1; fazla ayraç silme 1; diğer silme 3.
 * Toplam maliyet eşiği aşarsa null.
 */
export function alignToShape(input: string, slots: Slot[], maxCost = 3): { text: string; cost: number } | null {
  const S = slots.length, N = input.length;
  const INF = 1e9;
  const dp: number[][] = Array.from({ length: S + 1 }, () => new Array<number>(N + 1).fill(INF));
  const back: Array<Array<[number, number, string] | null>> = Array.from({ length: S + 1 }, () =>
    new Array<[number, number, string] | null>(N + 1).fill(null),
  );
  dp[0][0] = 0;
  for (let i = 0; i <= S; i++) {
    for (let j = 0; j <= N; j++) {
      const cur = dp[i][j];
      if (cur >= INF) continue;
      const relax = (ni: number, nj: number, cost: number, emit: string) => {
        if (cur + cost < dp[ni][nj]) {
          dp[ni][nj] = cur + cost;
          back[ni][nj] = [i, j, emit];
        }
      };
      if (j < N) {
        const ch = input[j];
        // Girdi karakterini sil
        relax(i, j + 1, SEP_CHARS.has(ch) ? 1 : 3, '');
      }
      if (i < S) {
        const slot = slots[i];
        if (slot.optional) relax(i + 1, j, 0, '');
        if (slot.kind === 'literal') relax(i + 1, j, 1, slot.literal!); // eksik literal ekle
        if (j < N) {
          const ch = input[j];
          if (slot.test(ch)) relax(i + 1, j + 1, 0, ch);
          else {
            const conv = slot.convert(ch);
            if (conv !== null) relax(i + 1, j + 1, 1, conv);
            else if (slot.kind === 'literal' && SEP_CHARS.has(ch)) relax(i + 1, j + 1, 1, slot.literal!); // yanlış ayraç
          }
        }
      }
    }
  }
  const cost = dp[S][N];
  if (cost >= INF || cost > maxCost) return null;
  // Geri izleme
  const parts: string[] = [];
  let i = S, j = N;
  while (i !== 0 || j !== 0) {
    const b = back[i][j];
    if (!b) break;
    parts.push(b[2]);
    i = b[0];
    j = b[1];
  }
  return { text: parts.reverse().join(''), cost };
}

/** Pattern tam eşleşme testi (pattern'e ^...$ sarılır). */
export function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return false;
  }
}

/** alnum/code: TR büyük harf, boşluk/noktalama temizliği; pattern sabit şekilliyse konumsal düzeltme. */
export function canonicalizeCode(raw: string, pattern?: string): { value: string | null; corrected: boolean; shapeSupported: boolean } {
  let s = trimPunct(collapseSpaces(turkishUpper(raw)));
  if (!s) return { value: null, corrected: false, shapeSupported: false };
  if (!pattern) return { value: s, corrected: false, shapeSupported: false };
  if (matchesPattern(s, pattern)) return { value: s, corrected: false, shapeSupported: true };
  const slots = parseShapePattern(pattern);
  if (!slots) return { value: s, corrected: false, shapeSupported: false };
  // Sırayla: ham; boşluksuz (OCR ayraç yerine boşluk okumuş olabilir); baştaki token(lar) atılmış
  // (etiket kalıntısı: "o: P401191" → "P401191")
  const tokens = s.split(' ');
  const candidates = [s, s.replace(/\s+/g, '')];
  for (let i = 1; i < tokens.length; i++) candidates.push(tokens.slice(i).join(' '));
  for (const c of candidates) {
    const aligned = alignToShape(c, slots);
    if (aligned && matchesPattern(aligned.text, pattern)) {
      return { value: aligned.text, corrected: aligned.text !== s, shapeSupported: true };
    }
  }
  return { value: s, corrected: false, shapeSupported: true };
}

