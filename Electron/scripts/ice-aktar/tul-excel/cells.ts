// Hücre okuma yardımcıları: değer/formül ayrımı ve "1,90 $" gibi metin sayıların yakalanması.
import type ExcelJS from "exceljs";
import type { GramFormula } from "./types.ts";

type Cell = ExcelJS.Cell;

/** Hücrenin görünen değeri (formülse sonuç) — ham biçimde. */
export function rawValue(cell: Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if ("result" in o) return o.result ?? null;
    if (typeof o.text === "string") return o.text;
    return null;
  }
  return v ?? null;
}

export function cellText(cell: Cell): string {
  const v = rawValue(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/** Formül metni (paylaşımlı formülde master'dan kaydırılmış hâli); formül yoksa "". */
export function formulaText(cell: Cell): string {
  try {
    return (cell.formula ?? "").replace(/\s+/g, "");
  } catch {
    return "";
  }
}

/** "1,90 $" → 1.9; sayıya çevrilemezse null. */
export function parseLooseNumber(text: string): number | null {
  // Sayı + isteğe bağlı birim/etiket kuyruğu ("1,90 $", "14 SIKLIK"); başka biçim çözülmez.
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(?:[$€₺]|[A-Za-zÇĞİÖŞÜçğıöşü]+)?\s*$/.exec(text.trim());
  return m ? Number((m[1] as string).replace(",", ".")) : null;
}

export interface NumberRead {
  value: number | null;
  /** Hücre sayı yerine metin taşıyorsa ham metin (METIN_SAYI adayı). */
  textual: string | null;
}

/** Sayısal alan okuması: gerçek sayı → value; metin → textual (+ çözülebilirse value). */
export function readNumber(cell: Cell): NumberRead {
  const v = rawValue(cell);
  if (typeof v === "number") return { value: v, textual: null };
  if (v === null || v === undefined || String(v).trim() === "") return { value: null, textual: null };
  const text = String(v).trim();
  return { value: parseLooseNumber(text), textual: text };
}

const WIDTH_MIN = 2;
const WIDTH_MAX = 5;

/**
 * Gramaj formülünü çözer: tek hücre başvurusu × çarpanlar ÷ bölen.
 * En (m) 2–5 aralığındaki çarpandır; denye kalan çarpandır. Çözülemezse null.
 */
export function parseGramFormula(formula: string): GramFormula | null {
  const f = formula.replace(/[()+\s]/g, "");
  if (!/^[A-Z]+\d+([*/]\d+(\.\d+)?)+$/.test(f)) return null;
  const ops = [...f.matchAll(/([*/])(\d+(?:\.\d+)?)/g)];
  const multipliers: number[] = [];
  const divisors: number[] = [];
  for (const m of ops) (m[1] === "*" ? multipliers : divisors).push(Number(m[2]));
  if (divisors.length !== 1) return null;
  const widths = multipliers.filter((n) => n >= WIDTH_MIN && n < WIDTH_MAX);
  const deniers = multipliers.filter((n) => n < WIDTH_MIN || n >= WIDTH_MAX);
  if (deniers.length !== 1 || widths.length > 1) return null;
  return { width: widths[0] ?? null, denier: deniers[0] as number, divisor: divisors[0] as number };
}

/** İplik adındaki nominal denye: "70/800 TERGAL" → 70, "300 İMG" → 300; yoksa null. */
export function nominalDenier(yarnName: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)(?=\s|\/|$|[A-ZÇĞİÖŞÜ])/i.exec(yarnName);
  if (!m) return null;
  const n = Number((m[1] as string).replace(",", "."));
  return n > 0 ? n : null;
}

/** Ad normalizasyonu (grup anahtarı): boşluk sadeleştirme + büyük harf. */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toUpperCase();
}

export function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
