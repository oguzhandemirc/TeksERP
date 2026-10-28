// Kaynak: ocr-test prototipi src/ocr-engine/validators.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Doğrulama: pattern tam eşleşme, min/max, tarih geçerliliği, enum eşleşmesi, required-but-null.
 * Her hata bir kod olarak döner.
 */
import type { FieldSpec } from "./types";
import { matchesPattern } from "./normalizers";

/** Doğrulama hatası sayılmayan bilgi amaçlı kodlar. */
export const SOFT_ISSUES = new Set(["corrected-by-shape", "low-ocr-confidence"]);

export function isHardIssue(code: string): boolean {
  return !SOFT_ISSUES.has(code);
}

/** Kanonik değeri alan tanımına göre doğrular; hata kodlarını döner (boş dizi = geçti). */
export function validateValue(spec: FieldSpec, value: string | null): string[] {
  const issues: string[] = [];
  if (value === null || value === "") {
    issues.push("not-found");
    return issues;
  }
  if (spec.pattern && !matchesPattern(value, spec.pattern)) issues.push("pattern-mismatch");
  switch (spec.type) {
    case "integer": {
      if (!/^-?\d+$/.test(value)) pushOnce(issues, "pattern-mismatch");
      const n = Number(value);
      if (Number.isFinite(n) && ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max))) issues.push("out-of-range");
      break;
    }
    case "decimal": {
      if (!/^-?\d+(\.\d+)?$/.test(value)) pushOnce(issues, "pattern-mismatch");
      const n = Number(value);
      if (Number.isFinite(n) && ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max))) issues.push("out-of-range");
      break;
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) issues.push("date-invalid");
      else {
        const [y, m, d] = value.split("-").map((x) => parseInt(x, 10));
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) issues.push("date-invalid");
      }
      break;
    }
    case "enum": {
      if (!(spec.enumValues ?? []).includes(value)) issues.push("enum-no-match");
      break;
    }
    default:
      break;
  }
  if (spec.maxLength !== undefined && value.length > spec.maxLength) issues.push("too-long");
  return issues;
}

function pushOnce(arr: string[], code: string) {
  if (!arr.includes(code)) arr.push(code);
}
