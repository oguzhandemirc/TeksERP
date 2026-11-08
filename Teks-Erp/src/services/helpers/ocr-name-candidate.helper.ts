// =============================================================================
// OCR'A DAYANIKLI AD ADAYLARI — okunan sahip adı kayıtlı bir cariye çözülemediğinde "Bunu mu demek istediniz?" listesi
// =============================================================================
// Kameradan okunan ad harf kaçırır/ekler ("HHL M", "ÖZTEKS1L"); 0,80 liste eşiği bunları kaçırıyordu (2026-11-08 saha).
// Yalnız ADAY üretir: öneri (≥ 0,90) ve otomatik seçim bu helper'ı OKUMAZ, tam metin taraması da (FULL_TEXT) kullanmaz.
// Dört sinyal, herhangi biri yeter, puan en güçlüsü: (a) kelime kapsama · (b) sıkıştırılmış metin içerme/önek ·
// (c) OCR karışıklıkları eşlenmiş karakter benzerliği · (d) firma benzerliği ≥ 0,5. Kısa ad gürültüsü alt sınırla kesilir.
// =============================================================================
import { FUZZY_NOISE_WORDS } from "../../constants/duplicate-rules";
import { editRatio, firmNameSimilarity, stripNoiseWords, tokenize } from "../../utils/string-similarity";
import { foldNameForCompare } from "./name-normalize.helper";

export interface OcrNameRow {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
}

export interface OcrNameCandidate extends OcrNameRow {
  readonly score: number;
}

/** Aday listesinin tavanı (tablet modalı). */
export const OCR_CANDIDATE_MAX = 5;
/** Sıkıştırılmış adın en kısa uzunluğu: altı (tek harf, "AB") her şeye benzer, aday üretmez. */
export const OCR_CANDIDATE_MIN_CHARS = 3;
/** Önek olmayan içermede kısa parçanın en kısa uzunluğu ("ali" ⊂ "kalite" sayılmasın). */
const CONTAIN_MIN_CHARS = 4;
const FIRM_MIN = 0.5;
/** Kısa adda (< `CONTAIN_MIN_CHARS`) yarı benzerlik tesadüftür ("ALİ" ↔ "KALİTE" 0,5): daha sıkı eşik. */
const FIRM_MIN_SHORT = 0.6;
const OCR_EDIT_MIN = 0.75;

// Katlanmış (küçük harf, ASCII) metinde sık OCR karışıklıkları tek sınıfa iner; iki tarafa da uygulanır.
const OCR_PAIRS: ReadonlyArray<readonly [RegExp, string]> = [
  [/rn/g, "m"], [/vv/g, "w"], [/0/g, "o"], [/[1l|!]/g, "i"], [/5/g, "s"], [/8/g, "b"], [/2/g, "z"], [/6/g, "g"],
];

/** Saf: OCR karışıklıklarını eşlenmiş sıkıştırılmış anahtar ("ÖZTEKS1L" ≡ "ÖZTEKSİL"). */
export function ocrCanonicalKey(compact: string): string {
  return OCR_PAIRS.reduce((s, [re, to]) => s.replace(re, to), compact);
}

const isOrderedSubsequence = (needle: readonly string[], hay: readonly string[]): boolean => {
  let i = 0;
  for (const w of hay) if (i < needle.length && w === needle[i]) i++;
  return needle.length > 0 && i === needle.length;
};

interface Prepared {
  readonly folded: string;
  readonly words: string[];
  readonly compact: string;
  readonly ocr: string;
}

function prepare(raw: string): Prepared {
  const folded = foldNameForCompare(raw);
  const words = tokenize(stripNoiseWords(folded, FUZZY_NOISE_WORDS));
  const compact = words.join("");
  return { folded, words, compact, ocr: ocrCanonicalKey(compact) };
}

/** Saf: iki adın OCR'a dayanıklı aday puanı (0 = aday değil). Sıkıştırılmış metin eşitse 1. */
export function ocrCandidateScore(text: string, name: string): number {
  return scorePrepared(prepare(text), prepare(name));
}

function scorePrepared(a: Prepared, b: Prepared): number {
  if (a.compact.length < OCR_CANDIDATE_MIN_CHARS || b.compact.length < OCR_CANDIDATE_MIN_CHARS) return 0;
  if (a.compact === b.compact) return 1;
  const [short, long] = a.compact.length <= b.compact.length ? [a, b] : [b, a];
  const ratio = short.compact.length / long.compact.length;
  let score = 0;
  // (a) kısa adın kelimeleri uzun adda sırayla geçer — OCR eşlenmiş kelimelerle ("HHL" ⊂ "HHL M").
  const sw = short.words.map((w) => ocrCanonicalKey(w));
  const lw = long.words.map((w) => ocrCanonicalKey(w));
  if (isOrderedSubsequence(sw, lw)) score = Math.max(score, 0.7 + 0.2 * ratio);
  // (b) sıkıştırılmış metin önek ya da (yeterince uzun parçada) içerme.
  if (long.ocr.startsWith(short.ocr) || (short.ocr.length >= CONTAIN_MIN_CHARS && long.ocr.includes(short.ocr))) score = Math.max(score, 0.6 + 0.25 * ratio);
  // (c) OCR karışıklıkları eşlendikten sonra karakter benzerliği.
  const ocrRatio = editRatio(a.ocr, b.ocr);
  if (ocrRatio >= OCR_EDIT_MIN) score = Math.max(score, 0.6 + 0.35 * ocrRatio);
  // (d) mükerrer motorunun firma benzerliği, düşük aday eşiğiyle.
  const firm = firmNameSimilarity(a.folded, b.folded, FUZZY_NOISE_WORDS);
  if (firm >= (short.compact.length < CONTAIN_MIN_CHARS ? FIRM_MIN_SHORT : FIRM_MIN)) score = Math.max(score, Math.min(firm, 0.99));
  return Math.round(score * 10000) / 10000;
}

/** Saf: okunan ada OCR'a dayanıklı yakın cariler, puana göre azalan, en çok `max`. */
export function ocrNameCandidates(text: string, rows: readonly OcrNameRow[], max = OCR_CANDIDATE_MAX): OcrNameCandidate[] {
  const a = prepare(text);
  if (a.compact.length < OCR_CANDIDATE_MIN_CHARS) return [];
  const out: OcrNameCandidate[] = [];
  for (const r of rows) {
    const score = scorePrepared(a, prepare(r.name));
    if (score > 0) out.push({ id: r.id, code: r.code, name: r.name, score });
  }
  return out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, "tr")).slice(0, max);
}
