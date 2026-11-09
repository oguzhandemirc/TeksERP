// Makul olmayan değer reddi (fail-closed): komşu alana kayan okuma ("Sevk Tarihi 20.10.2026" → en 20102026, "Müşteri KG
// 0,00" → parti no) forma/kilide değer diye girmesin; alan boş kalır. Etiket reddi ayrı (`label-guard.ts`).
import type { FieldResult, FieldSpec } from "./types";

export const DATE_AS_NUMBER = "date-as-number";
export const OUT_OF_PLAUSIBLE_RANGE = "out-of-plausible-range";
export const NUMBER_AS_BATCH = "number-as-batch";

/** Alan anahtarı → makul aralık (TEK yer). Şablon alanında `min`/`max` verilmişse o kazanır. */
export const PLAUSIBLE_RANGES: Readonly<Record<string, { min: number; max: number }>> = {
  en: { min: 10, max: 700 },
};

/** Parti/lot numarası alanları: yalnız ondalık sayı ("0,00", "238,00") parti no değildir. */
const BATCH_KEYS = new Set(["partiNo"]);

const DATE_RE = /^\s*\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}\s*$/;
/** Virgüllü ondalık (TR: "0,00", "1.234,50"); noktalı "12.345" parti no olabilir, reddedilmez. */
const DECIMAL_ONLY_RE = /^\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,3}\s*$/;

/** Ret kodu ya da null. `raw` OCR metnidir (birim/ek taşıyabilir), `value` kanonik değerdir. */
export function implausibleReason(spec: FieldSpec, value: string, raw: string | null): string | null {
  const r = (raw ?? value).replace(/\s*(cm|mt|m|kg|gr)\.?\s*$/iu, "");
  if ((spec.type === "decimal" || spec.type === "integer") && DATE_RE.test(r)) return DATE_AS_NUMBER;
  if (spec.type === "decimal" || spec.type === "integer") {
    const def = PLAUSIBLE_RANGES[spec.key];
    const min = spec.min ?? def?.min, max = spec.max ?? def?.max;
    const n = Number(value);
    if (Number.isFinite(n) && ((min !== undefined && n < min) || (max !== undefined && n > max))) return OUT_OF_PLAUSIBLE_RANGE;
  }
  if (BATCH_KEYS.has(spec.key) && (DECIMAL_ONLY_RE.test(r) || DECIMAL_ONLY_RE.test(value))) return NUMBER_AS_BATCH;
  return null;
}

/** Reddedilen değer boşalır: güven 0, ret kodu + gözden geçirme (canlı okumada oy olmaz, kilitlenmez). */
export function rejectImplausibleValue(fr: FieldResult, spec: FieldSpec): FieldResult {
  if (fr.value === null) return fr;
  const why = implausibleReason(spec, fr.value, fr.raw);
  return why ? { ...fr, value: null, confidence: 0, needsReview: true, issues: [why] } : fr;
}
