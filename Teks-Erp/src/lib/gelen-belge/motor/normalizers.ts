// Kaynak: ocr-test prototipi src/ocr-engine/normalizers.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Tip bazlı normalizasyon: ham OCR metnini kanonik değere çevirir ve OCR karışıklıklarını
 * (O↔0, I↔1, S↔5, B↔8, Z↔2, G↔6, D→0) tip/pattern bağlamında düzeltir.
 */
import type { CanonicalResult, FieldSpec, FieldType, PostProcess } from "./types";
import { collapseSpaces, normalizeForMatch, similarity, trimPunct, turkishUpper } from "./text-normalize";
import { LETTER_TO_DIGIT, canonicalizeCode, fixTextConfusions } from "./shape-align";

export { canonicalizeCode, fixTextConfusions, matchesPattern, parseShapePattern, alignToShape } from "./shape-align";

export type CanonicalizeSpec = Partial<
  Pick<FieldSpec, "pattern" | "enumValues" | "dateFormats" | "postProcess" | "maxLength" | "min" | "max">
>;

export const DEFAULT_DATE_FORMATS = ["DD.MM.YYYY", "DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YY"];

/** Birim sözcükleri (sayısal alanlarda atılır). */
const UNIT_WORDS = new Set([
  "m", "mt", "mtr", "metre", "kg", "g", "gr", "gram", "cm", "mm", "adet", "ad", "top", "tl", "pcs", "gsm",
  "g/m2", "g/m²", "gr/m2", "gr/m²", "lt", "l", "kgs", "rulo", "pk", "paket",
]);
const UNIT_SUFFIX_RE = /^(.*?\d)\s*(g\/m²|g\/m2|gr\/m²|gr\/m2|gsm|mtr|mt|m|kgs|kg|gr|g|cm|mm|adet|ad|top|tl|pcs|lt|l)\.?$/i;

/** Sayısal bağlamda karışıklık düzeltmesi: dizi yalnız rakam+karışabilir karakterlerden oluşuyorsa uygular. */
export function fixNumericConfusions(s: string): { text: string; corrected: boolean } {
  const allowed = /^[0-9OoQDIl|i!SsBZzG.,+\-\s]+$/;
  if (!allowed.test(s)) return { text: s, corrected: false };
  let corrected = false;
  let out = "";
  for (const ch of s) {
    const rep = LETTER_TO_DIGIT[ch];
    if (rep !== undefined) {
      out += rep;
      corrected = true;
    } else out += ch;
  }
  return { text: out, corrected };
}

/** Sayı dizesini (TR 1.234,56 / EN 1234.56) kanonik ondalık dizeye çevirir; çözülemezse null. */
export function parseNumber(raw: string): { value: string | null; corrected: boolean } {
  // Parantez/ayraç kalıntılarını at ("(m): 8.077,00" → "m 8.077,00"), birim sözcüklerini ayıkla
  let s = collapseSpaces(raw.replace(/[()[\]{}:;=]/g, " "));
  const tokens = s.split(" ").filter((t) => t && !UNIT_WORDS.has(t.toLowerCase().replace(/\.$/, "")));
  s = tokens.join("");
  const suffix = UNIT_SUFFIX_RE.exec(s);
  if (suffix) s = suffix[1];
  const fixed = fixNumericConfusions(s);
  s = fixed.text;
  const m = /[-+]?\d[\d.,]*/.exec(s);
  if (!m) return { value: null, corrected: false };
  let num = m[0];
  const hasDot = num.includes(".");
  const hasComma = num.includes(",");
  if (hasDot && hasComma) {
    // Son ayraç ondalık, diğeri binlik
    const lastDot = num.lastIndexOf(".");
    const lastComma = num.lastIndexOf(",");
    if (lastComma > lastDot) num = num.replace(/\./g, "").replace(",", ".");
    else num = num.replace(/,/g, "");
  } else if (hasComma) {
    const parts = num.split(",");
    // Tek virgül → ondalık (TR); birden çok virgül → binlik
    num = parts.length === 2 ? parts[0] + "." + parts[1] : parts.join("");
  } else if (hasDot) {
    const parts = num.split(".");
    // Tek nokta ve ardından tam 3 hane → TR binlik ("1.250" = 1250); birden çok nokta → binlik
    if (parts.length === 2 && parts[1].length === 3 && parts[0].replace(/[-+]/, "").length <= 3) num = parts.join("");
    else if (parts.length > 2) num = parts.join("");
  }
  num = num.replace(/[.,]+$/, "");
  const n = Number(num);
  if (!Number.isFinite(n)) return { value: null, corrected: false };
  return { value: formatNumber(n), corrected: fixed.corrected };
}

/** Kanonik sayı gösterimi: binlik yok, ondalık '.', sondaki sıfırlar yok. */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  let s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return s;
}

// ---------------------------------------------------------------------------
// Tarih
// ---------------------------------------------------------------------------

interface DateFormatSpec {
  re: RegExp;
  order: Array<"D" | "M" | "Y">;
  shortYear: boolean;
}

function compileDateFormat(fmt: string): DateFormatSpec | null {
  const order: Array<"D" | "M" | "Y"> = [];
  let re = "";
  let shortYear = false;
  let i = 0;
  while (i < fmt.length) {
    if (fmt.startsWith("YYYY", i)) {
      order.push("Y");
      re += '(\\d{4})';
      i += 4;
    } else if (fmt.startsWith("YY", i)) {
      order.push("Y");
      re += '(\\d{2})';
      shortYear = true;
      i += 2;
    } else if (fmt.startsWith("DD", i)) {
      order.push("D");
      re += '(\\d{1,2})';
      i += 2;
    } else if (fmt.startsWith("MM", i)) {
      order.push("M");
      re += '(\\d{1,2})';
      i += 2;
    } else {
      // Ayraç: karışık ayraçlara ve fazladan boşluğa tolerans (en az bir ayraç şart)
      re += '[.\\/\\-\\s]+';
      i += 1;
    }
  }
  if (order.length !== 3) return null;
  return { re: new RegExp('(?:^|\\D)' + re + '(?!\\d)'), order, shortYear };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Tarihi ISO 'YYYY-MM-DD' olarak çözer; çözülemezse null. */
export function parseDate(raw: string, formats: string[] = DEFAULT_DATE_FORMATS): { value: string | null; corrected: boolean } {
  const fixed = fixNumericConfusions(raw.replace(/\s+/g, " ").trim());
  const direct = parseDateWithFormats(fixed.text, formats);
  if (direct) return { value: direct, corrected: fixed.corrected };
  // Ayraçlar tamamen yutulmuşsa (12032026 / 120326): rakamları gün-ay-yıl olarak böl ve yeniden dene
  const digits = fixed.text.replace(/\D/g, "");
  if (digits.length === 8 || digits.length === 6) {
    const rebuilt = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    const v = parseDateWithFormats(rebuilt, formats);
    if (v) return { value: v, corrected: true };
  }
  return { value: null, corrected: false };
}

function parseDateWithFormats(s: string, formats: string[]): string | null {
  for (const fmt of formats) {
    const spec = compileDateFormat(fmt);
    if (!spec) continue;
    const m = spec.re.exec(s);
    if (!m) continue;
    let d = 0, mo = 0, y = 0;
    spec.order.forEach((k, idx) => {
      const v = parseInt(m[idx + 1], 10);
      if (k === 'D') d = v;
      else if (k === 'M') mo = v;
      else y = v;
    });
    if (spec.shortYear) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || y < 1900 || y > 2200) continue;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

/** enumValues'a bulanık eşleme (benzerlik ≥ threshold, en iyi). */
export function matchEnum(raw: string, enumValues: string[], threshold = 0.7): { value: string | null; similarity: number } {
  const whole = normalizeForMatch(raw);
  const tokens = whole.split(' ').filter(Boolean);
  const probes = [whole, ...tokens];
  let best: string | null = null;
  let bestSim = 0;
  for (const ev of enumValues) {
    const n = normalizeForMatch(ev);
    for (const p of probes) {
      const sim = similarity(p, n);
      if (sim > bestSim) {
        bestSim = sim;
        best = ev;
      }
    }
  }
  if (best !== null && bestSim >= threshold) return { value: best, similarity: bestSim };
  return { value: null, similarity: bestSim };
}

// ---------------------------------------------------------------------------
// postProcess
// ---------------------------------------------------------------------------

export function applyPostProcess(value: string, steps: PostProcess[] | undefined): string {
  let v = value;
  for (const step of steps ?? []) {
    switch (step) {
      case 'upper': v = turkishUpper(v); break;
      case 'stripSpaces': v = v.replace(/\s+/g, ''); break;
      case 'digitsOnly': v = v.replace(/\D+/g, ''); break;
      case 'trimPunct': v = trimPunct(v); break;
      case 'collapseSpaces': v = collapseSpaces(v); break;
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Giriş noktası
// ---------------------------------------------------------------------------

/** Ham metni alan tipine göre kanonik değere çevirir. */
export function canonicalizeValue(type: FieldType, raw: string | null | undefined, spec: CanonicalizeSpec = {}): CanonicalResult {
  const issues: string[] = [];
  if (raw === null || raw === undefined || raw.trim().length === 0) return { value: null, corrected: false, issues: ['not-found'] };
  switch (type) {
    case 'integer':
    case 'decimal': {
      const r = parseNumber(raw);
      if (r.value === null) return { value: null, corrected: false, issues: ['pattern-mismatch'] };
      if (r.corrected) issues.push('corrected-by-shape');
      return { value: r.value, corrected: r.corrected, issues };
    }
    case 'date': {
      const r = parseDate(raw, spec.dateFormats && spec.dateFormats.length > 0 ? spec.dateFormats : DEFAULT_DATE_FORMATS);
      if (r.value === null) return { value: null, corrected: false, issues: ['date-invalid'] };
      if (r.corrected) issues.push('corrected-by-shape');
      return { value: r.value, corrected: r.corrected, issues };
    }
    case 'alnum':
    case 'code': {
      const r = canonicalizeCode(raw, spec.pattern);
      if (r.value === null) return { value: null, corrected: false, issues: ['not-found'] };
      let v = applyPostProcess(r.value, spec.postProcess);
      if (spec.maxLength && v.length > spec.maxLength) v = v.slice(0, spec.maxLength);
      if (r.corrected) issues.push('corrected-by-shape');
      return { value: v, corrected: r.corrected, issues };
    }
    case 'enum': {
      const r = matchEnum(raw, spec.enumValues ?? []);
      if (r.value === null) return { value: null, corrected: false, issues: ['enum-no-match'] };
      return { value: r.value, corrected: false, issues };
    }
    case 'text':
    default: {
      const fixed = fixTextConfusions(collapseSpaces(raw));
      let v = applyPostProcess(fixed.text, spec.postProcess);
      if (fixed.corrected) issues.push('corrected-by-shape');
      // Baştaki ayraç kalıntısını at (": ABC" → "ABC"); sondaki noktalama anlamlı olabilir (A.Ş.)
      v = v.replace(/^[\s:;=\-–—]+/, '');
      if (spec.maxLength && v.length > spec.maxLength) v = v.slice(0, spec.maxLength).trim();
      if (!v) return { value: null, corrected: false, issues: ['not-found'] };
      return { value: v, corrected: fixed.corrected, issues };
    }
  }
}
