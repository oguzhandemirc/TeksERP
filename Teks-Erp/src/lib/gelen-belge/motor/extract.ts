// Kaynak: ocr-test prototipi src/ocr-engine/extract.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Alan çıkarımı: stratejiler sırayla denenir, adaylar normalize/doğrulanır, güven hesaplanır.
 */
import type { DocumentTemplate, ExtractOptions, ExtractionResult, FieldResult, FieldSpec, OcrResult } from "./types";
import { buildRows, rowsToText } from "./geometry";
import { canonicalizeValue } from "./normalizers";
import { validateValue, isHardIssue } from "./validators";
import { computeConfidence, needsReview as computeNeedsReview, LOW_OCR_CONFIDENCE } from "./confidence";
import { runStrategy, type RawCandidate, type StrategyContext } from "./strategies";

/** Bir ham adayı tam FieldResult'a çevirir. */
export function evaluateCandidate(field: FieldSpec, cand: RawCandidate, defaultMin: number): FieldResult {
  const canon = canonicalizeValue(field.type, cand.raw, field);
  const issues = [...canon.issues];
  if (canon.value !== null) {
    for (const code of validateValue(field, canon.value)) if (!issues.includes(code)) issues.push(code);
  }
  if (cand.ocrConfidence !== null && cand.ocrConfidence < LOW_OCR_CONFIDENCE) issues.push("low-ocr-confidence");
  const confidence = computeConfidence({
    value: canon.value,
    ocrConfidence: cand.ocrConfidence,
    labelSimilarity: cand.labelSimilarity,
    issues,
    corrected: canon.corrected,
    spec: field,
  });
  return {
    key: field.key,
    value: canon.value,
    raw: cand.raw,
    confidence,
    needsReview: computeNeedsReview(confidence, issues, field, defaultMin),
    source: { strategy: cand.kind, anchor: cand.anchor, rect: cand.rect, strategyIndex: cand.strategyIndex },
    issues,
  };
}

function isAcceptable(fr: FieldResult, field: FieldSpec, defaultMin: number): boolean {
  if (fr.value === null) return false;
  if (fr.issues.some(isHardIssue)) return false;
  return fr.confidence >= (field.minConfidence ?? defaultMin);
}

function emptyResult(field: FieldSpec): FieldResult {
  return {
    key: field.key,
    value: null,
    raw: null,
    confidence: 0,
    needsReview: true,
    source: { strategy: "none" },
    issues: ["not-found"],
  };
}

/** Şablondaki diğer alanların anchor etiketleri. */
function otherLabelsFor(template: DocumentTemplate, field: FieldSpec): string[] {
  const own = new Set<string>();
  for (const s of field.strategies) if (s.kind === "anchor") s.labels.forEach((l) => own.add(l));
  const out: string[] = [];
  for (const f of template.fields) {
    if (f.key === field.key) continue;
    for (const s of f.strategies) if (s.kind === "anchor") for (const l of s.labels) if (!own.has(l)) out.push(l);
  }
  return out;
}

/** Kabul edilen aday yokken sonraki adayın öne geçmesi için gereken asgari güven farkı. */
const FALLBACK_MARGIN = 0.05;

export function extractFields(ocr: OcrResult, template: DocumentTemplate, options: ExtractOptions = {}): ExtractionResult {
  const started = Date.now();
  const defaultMin = options.defaultMinConfidence ?? 0.85;
  const rows = buildRows(ocr);
  const fullText = rowsToText(rows);
  const warnings: string[] = [];
  const fields: Record<string, FieldResult> = {};

  for (const field of template.fields) {
    const ctx: StrategyContext = { ocr, rows, fullText, otherLabels: otherLabelsFor(template, field), warnings };
    const evaluated: FieldResult[] = [];
    let chosen: FieldResult | null = null;
    outer: for (let si = 0; si < field.strategies.length; si++) {
      const cands = runStrategy(field.strategies[si], si, field, ctx);
      for (const c of cands) {
        const fr = evaluateCandidate(field, c, defaultMin);
        evaluated.push(fr);
        if (!chosen && isAcceptable(fr, field, defaultMin)) {
          chosen = fr;
          if (!options.collectCandidates) break outer;
        }
      }
    }
    if (!chosen) {
      // Hiçbiri kabul edilmedi → en yüksek güvenli aday (değeri olan tercih edilir)
      const withValue = evaluated.filter((e) => e.value !== null);
      const pool = withValue.length > 0 ? withValue : evaluated;
      // Güven farkı küçükse (≤ FALLBACK_MARGIN) daha erken strateji/aday öncelikli
      chosen = pool.reduce<FieldResult | null>((best, e) => (best === null || e.confidence > best.confidence + FALLBACK_MARGIN ? e : best), null);
      // Değer var ama eşik altı → 'low-confidence'; değer yoksa 'not-found'
      if (chosen) {
        const issues = chosen.issues.length > 0 ? chosen.issues : [chosen.value === null ? "not-found" : "low-confidence"];
        chosen = { ...chosen, needsReview: true, issues };
      }
    }
    if (!chosen) chosen = emptyResult(field);
    if (options.collectCandidates) {
      chosen.candidates = evaluated
        .filter((e) => e.value !== null)
        .map((e) => ({ value: e.value as string, confidence: e.confidence }));
    }
    fields[field.key] = chosen;
  }

  const required = template.fields.filter((f) => f.required);
  const pool = required.length > 0 ? required : template.fields;
  const overallConfidence = pool.length === 0 ? 0 : round4(pool.reduce((s, f) => s + fields[f.key].confidence, 0) / pool.length);

  return {
    templateId: template.id,
    templateVersion: template.version,
    fields,
    overallConfidence,
    durationMs: Date.now() - started,
    warnings,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
