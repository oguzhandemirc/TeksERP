// Kaynak: ocr-test prototipi src/ocr-engine/merge.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Çoklu çekim birleştirme: alan bazında kanonik değer oylaması.
 */
import type { DocumentTemplate, ExtractionResult, FieldResult } from "./types";
import { needsReview as computeNeedsReview, clamp01 } from "./confidence";

export function mergeExtractions(results: ExtractionResult[], template: DocumentTemplate, defaultMin = 0.85): ExtractionResult {
  const started = Date.now();
  const fields: Record<string, FieldResult> = {};
  const warnings = new Set<string>();
  for (const r of results) r.warnings.forEach((w) => warnings.add(w));

  for (const spec of template.fields) {
    const entries = results.map((r) => r.fields[spec.key]).filter((f): f is FieldResult => !!f);
    if (entries.length === 0) {
      fields[spec.key] = { key: spec.key, value: null, raw: null, confidence: 0, needsReview: true, source: { strategy: "none" }, issues: ["not-found"] };
      continue;
    }
    const tally = new Map<string, { sum: number; count: number; best: FieldResult }>();
    for (const e of entries) {
      if (e.value === null) continue;
      const t = tally.get(e.value);
      if (t) {
        t.sum += e.confidence;
        t.count++;
        if (e.confidence > t.best.confidence) t.best = e;
      } else tally.set(e.value, { sum: e.confidence, count: 1, best: e });
    }
    if (tally.size === 0) {
      // Hiçbir çekimde değer yok
      const base = entries.reduce((b, e) => (e.confidence > b.confidence ? e : b), entries[0]);
      fields[spec.key] = { ...base, needsReview: true };
      continue;
    }
    let winner: { value: string; sum: number; count: number; best: FieldResult } | null = null;
    for (const [value, t] of tally) if (!winner || t.sum > winner.sum) winner = { value, ...t };
    const w = winner!;
    let confidence = w.best.confidence;
    if (w.count >= 2) confidence = clamp01(confidence + 0.1);
    else if (tally.size > 1) confidence = confidence * 0.8;
    confidence = Math.round(confidence * 10000) / 10000;
    const issues = [...w.best.issues];
    fields[spec.key] = {
      ...w.best,
      confidence,
      issues,
      needsReview: computeNeedsReview(confidence, issues, spec, defaultMin),
      candidates: [...tally.entries()].map(([value, t]) => ({ value, confidence: Math.round(t.sum * 10000) / 10000 })).sort((a, b) => b.confidence - a.confidence),
    };
  }

  const required = template.fields.filter((f) => f.required);
  const pool = required.length > 0 ? required : template.fields;
  const overallConfidence = pool.length === 0 ? 0 : Math.round((pool.reduce((s, f) => s + (fields[f.key]?.confidence ?? 0), 0) / pool.length) * 10000) / 10000;
  return {
    templateId: template.id,
    templateVersion: template.version,
    fields,
    overallConfidence,
    durationMs: Date.now() - started,
    warnings: [...warnings],
  };
}
