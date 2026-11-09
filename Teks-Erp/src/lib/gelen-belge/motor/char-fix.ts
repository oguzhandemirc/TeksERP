// Alan tipine göre karakter düzeltme (saf, 2026-11-09): kod alanında (alnum/code) OCR'ın karıştırdığı harf↔rakamı
// alanın biçim kuralına (şablon `pattern` ya da tanıtmada öğrenilen `valueShape`) göre düzeltir. Kurala uyan TEK en az
// değişiklikli aday yoksa dokunmaz. Sayısal alanlar `parseNumber`da (rakam bağlamında O→0, I/l→1, S→5, B→8, Z→2) zaten düzelir.
import type { CanonicalResult, FieldSpec } from "./types";
import { canonicalizeValue } from "./normalizers";
import { matchesPattern } from "./shape-align";

/** Kod alanında karışan karakter çiftleri (iki yön; büyük harfli kanonik değer üzerinde). */
const SWAP: Readonly<Record<string, string>> = { O: "0", "0": "O", Q: "0", I: "1", "1": "I", S: "5", "5": "S", B: "8", "8": "B", Z: "2", "2": "Z", G: "6", "6": "G" };
/** En çok bu kadar karakter değiştirilir: daha fazlası düzeltme değil başka değerdir. */
const MAX_SWAPS = 2;
/** Arama tavanı (değiştirilebilir konum sayısı); uzun serbest metinde aday patlaması olmasın. */
const MAX_SWAP_POSITIONS = 24;

const isCode = (f: Pick<FieldSpec, "type">): boolean => f.type === "alnum" || f.type === "code";

/**
 * Saf: kod sözcüğünde küçük `l`/`|` = büyük I ya da 1 (sans-serif yazıda üçü aynı çizgidir). Yalnız sözcükte başka küçük
 * harf yokken ("lSM1439770"); komşu büyük harfse I, rakamsa 1. "Ali", "lot" gibi sözcüklere dokunulmaz.
 */
export function fixLowerLInCode(raw: string): { text: string; corrected: boolean } {
  let corrected = false;
  const text = raw.replace(/\S+/g, (tok) => {
    if (!/[l|]/.test(tok) || /[a-km-zçğıöşü]/u.test(tok) || !/[\p{Lu}\d]/u.test(tok.replace(/[l|]/g, ""))) return tok;
    const ch = [...tok];
    const out = ch.map((c, i) => {
      if (c !== "l" && c !== "|") return c;
      const near = [ch[i - 1], ch[i + 1]].filter((x): x is string => !!x && x !== "l" && x !== "|");
      const letter = near.some((x) => /\p{Lu}/u.test(x));
      const digit = near.some((x) => /\d/.test(x));
      if (!letter && !digit) return c;
      corrected = true;
      return letter && !(digit && near.every((x) => /\d/.test(x))) ? "I" : "1";
    });
    return out.join("");
  });
  return { text, corrected };
}

/** Saf: alanın biçim kuralları — şablon `pattern`i + anchor stratejilerinin öğrenilmiş `valueShape`i. */
export function fieldShapes(field: Pick<FieldSpec, "pattern" | "strategies">): Array<(v: string) => boolean> {
  const out: Array<(v: string) => boolean> = [];
  if (field.pattern) {
    const p = field.pattern;
    out.push((v) => matchesPattern(v, p));
  }
  for (const s of field.strategies ?? []) {
    if (s.kind !== "anchor" || !s.valueShape) continue;
    try {
      const re = new RegExp(s.valueShape, "u");
      out.push((v) => re.test(v));
    } catch {
      // bozuk biçim fail-soft: kural yok sayılır
    }
  }
  return out;
}

function* combos(n: number, k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < n; i++) yield* combos(n, k, i + 1, [...acc, i]);
}

const cls = (c: string | undefined): "d" | "l" | null => (c === undefined ? null : /\d/.test(c) ? "d" : /\p{L}/u.test(c) ? "l" : null);

/** Saf: karakter değiştirilebilir mi — yeni sınıfı (rakam/harf) mevcut komşularının HEPSİYLE aynı, kendisininkinden farklı. */
function swappable(chars: readonly string[], i: number): boolean {
  const to = SWAP[chars[i]!];
  if (to === undefined) return false;
  const want = cls(to);
  const near = [cls(chars[i - 1]), cls(chars[i + 1])].filter((x): x is "d" | "l" => x !== null);
  return near.length > 0 && near.every((x) => x === want) && cls(chars[i]) !== want;
}

/**
 * Saf: değer kurallardan birine uymuyorsa, yalnız BAĞLAMA uyan değişikliklerle (rakamlar arasındaki O → 0, harfler
 * arasındaki 1 → I; ≤ MAX_SWAPS) kurala uyan aday; o seviyede tek aday yoksa null. Öğrenilmiş biçim yanlış bir
 * okumadan öğrenilmiş olabilir ("1SM…"): bağlam şartı doğru okunan "ISM…"yu ona çevirmez. "ISM14397O0" → "ISM1439700".
 */
export function fixCodeByShape(value: string, shapes: ReadonlyArray<(v: string) => boolean>): string | null {
  if (shapes.length === 0 || shapes.some((ok) => ok(value))) return null;
  const chars = [...value];
  const pos = chars.flatMap((_, i) => (swappable(chars, i) ? [i] : []));
  if (pos.length === 0 || pos.length > MAX_SWAP_POSITIONS) return null;
  for (let k = 1; k <= Math.min(MAX_SWAPS, pos.length); k++) {
    const hits = new Set<string>();
    for (const pick of combos(pos.length, k)) {
      const c = [...chars];
      for (const p of pick) c[pos[p]!] = SWAP[c[pos[p]!]!]!;
      const cand = c.join("");
      if (shapes.some((ok) => ok(cand))) hits.add(cand);
      if (hits.size > 1) return null;
    }
    if (hits.size === 1) return [...hits][0]!;
  }
  return null;
}

/**
 * Motorun alan normalizasyonu + tip düzeltmesi (TEK giriş, `evaluateCandidate` çağırır). Kod alanı dışında
 * `canonicalizeValue` ile birebir aynıdır. Düzeltme `corrected` + `corrected-by-shape` işaretiyle döner (güven 0,9 katı).
 */
export function canonicalizeField(field: FieldSpec, raw: string | null | undefined): CanonicalResult {
  if (!isCode(field) || raw == null) return canonicalizeValue(field.type, raw, field);
  const pre = fixLowerLInCode(raw);
  const canon = canonicalizeValue(field.type, pre.text, field);
  let { value, corrected } = canon;
  const issues = [...canon.issues];
  if (value !== null) {
    const shaped = fixCodeByShape(value, fieldShapes(field));
    if (shaped !== null) {
      value = shaped;
      corrected = true;
    }
  }
  corrected = corrected || (pre.corrected && value !== null);
  if (corrected && !issues.includes("corrected-by-shape")) issues.push("corrected-by-shape");
  return { value, corrected, issues };
}
