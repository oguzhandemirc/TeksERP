// Kaynak: ocr-test prototipi src/ocr-engine/confidence.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Güven skoru: conf = ocrConf × labelSim × validationFactor.
 */
import type { FieldSpec } from "./types";
import { isHardIssue } from "./validators";

/** OCR güveni yoksa varsayılan. */
export const DEFAULT_OCR_CONFIDENCE = 0.85;
/** Bu değerin altındaki OCR güveni 'low-ocr-confidence' uyarısı üretir. */
export const LOW_OCR_CONFIDENCE = 0.6;

export interface ConfidenceInput {
  value: string | null;
  ocrConfidence: number | null;
  labelSimilarity: number;
  issues: string[];
  corrected: boolean;
  spec: FieldSpec;
}

/**
 * validationFactor: bulunamadı 0; doğrulama başarısız 0.4; konumsal düzeltmeyle geçti 0.9;
 * pattern yok ve yalnız tip çözüldü (text/alnum) 0.95; doğrulama geçti 1.0.
 */
export function validationFactor(input: ConfidenceInput): number {
  if (input.value === null) return 0;
  if (input.issues.some(isHardIssue)) return 0.4;
  if (input.corrected) return 0.9;
  const typed = input.spec.type === "date" || input.spec.type === "integer" || input.spec.type === "decimal" || input.spec.type === "enum";
  if (!input.spec.pattern && !typed) return 0.95;
  return 1;
}

export function computeConfidence(input: ConfidenceInput): number {
  const ocr = input.ocrConfidence ?? DEFAULT_OCR_CONFIDENCE;
  const conf = clamp01(ocr) * clamp01(input.labelSimilarity) * validationFactor(input);
  return Math.round(conf * 10000) / 10000;
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function needsReview(confidence: number, issues: string[], spec: FieldSpec, defaultMin = 0.85): boolean {
  const threshold = spec.minConfidence ?? defaultMin;
  return confidence < threshold || issues.length > 0;
}
