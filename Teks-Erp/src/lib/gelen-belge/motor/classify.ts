// Kaynak: ocr-test prototipi src/ocr-engine/classify.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Belge sınıflandırma: keywords'ün (bulanık, TR-normalize) metinde bulunma oranı + regex bonusu.
 */
import type { ClassificationResult, DocumentTemplate, OcrResult } from "./types";
import { readingOrderText } from "./geometry";
import { normalizeForMatch, similarity } from "./text-normalize";
import { isStrongIdentifier } from "./kimlik-gucu";

const KEYWORD_MIN_SIMILARITY = 0.8;
const REGEX_BONUS = 0.3;

/** Anahtar kelime metinde (bulanık) geçiyor mu? */
export function keywordFound(normText: string, normKeyword: string, minSim = KEYWORD_MIN_SIMILARITY): boolean {
  if (!normKeyword) return false;
  if (normText.includes(normKeyword)) return true;
  const words = normText.split(" ").filter(Boolean);
  const k = normKeyword.split(" ").length;
  for (let i = 0; i + k <= words.length; i++) {
    const win = words.slice(i, i + k).join(" ");
    if (similarity(win, normKeyword) >= minSim) return true;
  }
  return false;
}

export function scoreTemplate(text: string, normText: string, template: DocumentTemplate): number {
  const keywords = template.identifiers.keywords ?? [];
  let score = 0;
  if (keywords.length > 0) {
    let hits = 0;
    for (const kw of keywords) if (keywordFound(normText, normalizeForMatch(kw))) hits++;
    score = hits / keywords.length;
  }
  for (const pattern of template.identifiers.regex ?? []) {
    try {
      if (new RegExp(pattern, "i").test(text)) {
        score += REGEX_BONUS;
        break;
      }
    } catch {
      // Hatalı regex sessizce atlanır
    }
  }
  return Math.min(1, Math.round(score * 10000) / 10000);
}

/** Ayırt edici kimlik belgede var mı: regex'i ya da en az bir GÜÇLÜ (genel etiket olmayan) yazısı tutuyor (`kimlik-gucu.ts`). */
export function hasDistinctiveHit(text: string, normText: string, template: DocumentTemplate): boolean {
  for (const pattern of template.identifiers.regex ?? []) {
    try {
      if (new RegExp(pattern, "i").test(text)) return true;
    } catch {
      // Hatalı regex sessizce atlanır
    }
  }
  return (template.identifiers.keywords ?? []).some((kw) => isStrongIdentifier(kw) && keywordFound(normText, normalizeForMatch(kw)));
}

/** Şablonun kimlik eşiği — sınıflandırma ve "benzer şablon" uyarısı (K30-B) AYNI eşiği kullanır. */
export const DEFAULT_TEMPLATE_MIN_SCORE = 0.5;
export const templateMinScore = (t: DocumentTemplate): number => t.identifiers.minScore ?? DEFAULT_TEMPLATE_MIN_SCORE;

/** Şablon bu belgeye aday mı — TEK yüklem: skor eşiği + ayırt edici kimlik (yalnız genel etiketlerle eşleşme aday yapmaz). */
export const templateMatches = (text: string, normText: string, t: DocumentTemplate, score: number): boolean =>
  score >= templateMinScore(t) && hasDistinctiveHit(text, normText, t);

/** Bu belgede kimlik eşiğini geçen şablonlar, skora göre azalan (eşitlikte kod sırası — belirlenimli). */
export function templatesOverThreshold(ocr: OcrResult, templates: readonly DocumentTemplate[]): Array<{ template: DocumentTemplate; score: number }> {
  const text = readingOrderText(ocr);
  const normText = normalizeForMatch(text);
  return templates
    .map((template) => ({ template, score: scoreTemplate(text, normText, template) }))
    .filter((x) => templateMatches(text, normText, x.template, x.score))
    .sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));
}

/** Kullanıcı (tanıtılmış) şablon kimliğinin öneki — servis katmanı da buradan okur. */
export const USER_TEMPLATE_ID_PREFIX = "u-";

export function classifyDocument(ocr: OcrResult, templates: DocumentTemplate[]): ClassificationResult {
  const text = readingOrderText(ocr);
  const normText = normalizeForMatch(text);
  const scores: Record<string, number> = {};
  let best: { id: string; score: number } | null = null;
  for (const t of templates) {
    const s = scoreTemplate(text, normText, t);
    scores[t.id] = s;
    if (templateMatches(text, normText, t, s) && (best === null || s > best.score)) best = { id: t.id, score: s };
  }
  return { templateId: best?.id ?? null, score: best?.score ?? 0, scores };
}

/**
 * D3a: GENEL şablon yalnız YEDEKTİR — puanlamaya girmez; hiçbir gönderen şablonu eşiği geçmezse seçilir
 * (TASARIM-KARARI §5 "bilinmeyen yerleşim": GENEL sözlük + "şablon yok" uyarısı).
 */
export function classifyWithFallback(ocr: OcrResult, templates: DocumentTemplate[], fallbackId: string | null): ClassificationResult {
  const candidates = templates.filter((t) => t.id !== fallbackId);
  // Kullanıcının tanıttığı tip eşiği geçtiyse hazır şablonun önüne geçer (yeniden tanıtma hazır şablonu pasifleştirmeden işler).
  const own = classifyDocument(ocr, candidates.filter((t) => t.id.startsWith(USER_TEMPLATE_ID_PREFIX)));
  if (own.templateId !== null) return { ...own, scores: classifyDocument(ocr, candidates).scores };
  const r = classifyDocument(ocr, candidates);
  if (r.templateId !== null || fallbackId === null) return r;
  if (!templates.some((t) => t.id === fallbackId)) return r;
  return { templateId: fallbackId, score: 0, scores: r.scores };
}
