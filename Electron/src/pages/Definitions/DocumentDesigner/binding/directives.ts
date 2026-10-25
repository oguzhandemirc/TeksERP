/**
 * Yönerge dilbilgisinin İSTEMCİ aynası (backend `motor/yonerge-dilbilgisi.ts`):
 * `data-if` kurucusu yalnız derleyicinin kabul ettiği biçimi üretir, geçersiz girdi
 * öznitelik olmadan reddedilir. Aynalık `belge-tasarimci-gidis-donus.json` üstünden
 * backend bekçisiyle (`test_belge_tasarimci_gidis_donus`) ölçülür.
 */
import type { FieldType } from "./contract";

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/;
export const LOOP_VAR = /^[a-z_][a-z0-9_]*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const STRING = /^"[^"{}%]*"$/;
export const CONDITION_LITERALS = ["true", "false", "nil", "blank"] as const;

export const CONDITION_OPERATORS = [
  { op: "==", label: "eşittir" },
  { op: "!=", label: "eşit değil" },
  { op: ">", label: "büyüktür" },
  { op: "<", label: "küçüktür" },
  { op: ">=", label: "büyük ya da eşit" },
  { op: "<=", label: "küçük ya da eşit" },
  { op: "contains", label: "içerir" },
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]["op"];
const OPERATOR_SET: ReadonlySet<string> = new Set(CONDITION_OPERATORS.map((o) => o.op));

/** Backend `ALLOWED_FILTER_NAMES` alt kümesi (izinli yerleşikler + kendi filtrelerimiz). */
export const FILTER_NAMES: readonly string[] = [
  "tarih", "tarih_saat", "takvim", "saat", "sayi", "metre", "kg", "adet", "para", "yaziyla",
  "barkod", "qr", "css_metin", "satir_kir", "upcase", "downcase", "capitalize", "escape",
  "default", "strip", "truncate", "replace", "append", "prepend", "first", "last", "size", "join",
];
const FILTER_SET: ReadonlySet<string> = new Set(FILTER_NAMES);

export function isPath(x: string): boolean {
  return PATH.test(x);
}

/** Kurucu satırı: ilk satırda `join` yok sayılır; `op` boşsa yalnız "yol doluysa". */
export interface ConditionRow {
  join: "and" | "or";
  path: string;
  op: ConditionOperator | "";
  valueKind: "metin" | "sayi" | "sabit";
  value: string;
}

export type BuildResult = { ok: true; value: string } | { ok: false; error: string; row: number };

function valueToken(r: ConditionRow): string | null {
  if (r.valueKind === "sayi") return NUMBER.test(r.value.trim()) ? r.value.trim() : null;
  if (r.valueKind === "sabit") return (CONDITION_LITERALS as readonly string[]).includes(r.value) ? r.value : null;
  const t = `"${r.value}"`;
  return STRING.test(t) ? t : null;
}

/** Satırlar → `data-if` değeri. Parantez yok; dilbilgisi dışı her girdi Türkçe hatayla reddedilir. */
export function buildCondition(rows: readonly ConditionRow[]): BuildResult {
  if (rows.length === 0) return { ok: false, error: "En az bir koşul satırı gerekli", row: 0 };
  const parts: string[] = [];
  for (const [i, r] of rows.entries()) {
    if (!isPath(r.path.trim())) return { ok: false, error: `Satır ${i + 1}: alan seçilmedi ya da yol geçersiz`, row: i };
    if (i > 0) parts.push(r.join);
    parts.push(r.path.trim());
    if (r.op) {
      const v = valueToken(r);
      if (v === null) {
        const why = r.valueKind === "metin" ? 'metin içinde " { } % kullanılamaz' : r.valueKind === "sayi" ? "geçerli bir sayı yazın (ör. 12,5 değil 12.5)" : "sabit değer seçin";
        return { ok: false, error: `Satır ${i + 1}: değer geçersiz — ${why}`, row: i };
      }
      parts.push(r.op, v);
    }
  }
  return { ok: true, value: parts.join(" ") };
}

function splitWords(expr: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i]!)) {
      i++;
      continue;
    }
    if (expr[i] === '"') {
      const k = expr.indexOf('"', i + 1);
      if (k < 0) return null;
      out.push(expr.slice(i, k + 1));
      i = k + 1;
      continue;
    }
    let j = i;
    while (j < expr.length && !/\s/.test(expr[j]!) && expr[j] !== '"') j++;
    out.push(expr.slice(i, j));
    i = j;
  }
  return out;
}

function rowValue(token: string): Pick<ConditionRow, "valueKind" | "value"> | null {
  if (STRING.test(token)) return { valueKind: "metin", value: token.slice(1, -1) };
  if (NUMBER.test(token)) return { valueKind: "sayi", value: token };
  if ((CONDITION_LITERALS as readonly string[]).includes(token)) return { valueKind: "sabit", value: token };
  return null;
}

/** Var olan `data-if` → kurucu satırları; dilbilgisine uymuyorsa null (kurucu boş açılır). */
export function parseCondition(raw: string): ConditionRow[] | null {
  const p = splitWords(raw.trim());
  if (!p || p.length === 0) return null;
  const rows: ConditionRow[] = [];
  let i = 0;
  let join: "and" | "or" = "and";
  for (;;) {
    const path = p[i];
    if (path === undefined || !isPath(path)) return null;
    const row: ConditionRow = { join, path, op: "", valueKind: "metin", value: "" };
    i++;
    if (p[i] !== undefined && OPERATOR_SET.has(p[i]!)) {
      const v = p[i + 1] === undefined ? null : rowValue(p[i + 1]!);
      if (!v) return null;
      row.op = p[i] as ConditionOperator;
      Object.assign(row, v);
      i += 2;
    }
    rows.push(row);
    if (i >= p.length) return rows;
    if (p[i] !== "and" && p[i] !== "or") return null;
    join = p[i] as "and" | "or";
    i++;
  }
}

/** Serbest yazılmış `data-if` denetimi — kurucu dışı düzenlemede de aynı kapı. */
export function validateCondition(raw: string): string | null {
  return parseCondition(raw) ? null : "Koşul dilbilgisine uymuyor: yol (op değer) (and|or yol …); parantez yok";
}

/** `data-filtre` denetimi: `ad(: arg(, arg)*)? (| ad …)*`, ad izin listesinden. */
export function validateFilterChain(raw: string): string | null {
  if (raw.trim() === "") return null;
  for (const piece of raw.split("|")) {
    const m = /^([a-z_][a-z0-9_]*)\s*(?::\s*(.+))?$/.exec(piece.trim());
    if (!m) return `Filtre biçimi tanınmadı: '${piece.trim()}'`;
    if (!FILTER_SET.has(m[1]!)) return `İzinsiz filtre: '${m[1]}'`;
    if (m[2] === undefined) continue;
    for (const a of m[2].split(",").map((x) => x.trim())) {
      if (!(NUMBER.test(a) || STRING.test(a) || (CONDITION_LITERALS as readonly string[]).includes(a))) {
        return `'${m[1]}' filtresinin argümanı geçersiz: '${a}'`;
      }
    }
  }
  return null;
}

export interface FilterSuggestion {
  value: string;
  label: string;
}

/** Alan türünden filtre önerisi (ilk öneri varsayılandır). */
export function suggestFilters(tur: FieldType, opts: { ondalik?: number; birim?: string } = {}): FilterSuggestion[] {
  switch (tur) {
    case "tarih":
      return [{ value: "tarih", label: "Tarih (GG.AA.YYYY)" }, { value: "takvim", label: "Takvim günü" }];
    case "tarih_saat":
      return [{ value: "tarih_saat", label: "Tarih ve saat" }, { value: "tarih", label: "Yalnız tarih" }, { value: "saat", label: "Yalnız saat" }];
    case "takvim":
      return [{ value: "takvim", label: "Takvim günü" }];
    case "para":
      return [{ value: 'para: "TRY"', label: "Para (TRY)" }, { value: "para", label: "Para (birimsiz)" }, { value: 'yaziyla: "TRY"', label: "Yazıyla" }];
    case "sayi":
      return numberSuggestions(opts);
    case "metin":
      return [{ value: "", label: "Olduğu gibi" }, { value: "upcase", label: "BÜYÜK HARF" }, { value: 'default: "-"', label: "Boşsa “-”" }];
    default:
      return [];
  }
}

function numberSuggestions(opts: { ondalik?: number; birim?: string }): FilterSuggestion[] {
  const out: FilterSuggestion[] = [];
  if (opts.birim === "m") out.push({ value: "metre", label: "Metre (m)" });
  if (opts.birim === "kg") out.push({ value: "kg", label: "Kilogram (kg)" });
  const d = opts.ondalik ?? 0;
  out.push({ value: `sayi: ${d}`, label: `Sayı (${d} hane)` });
  if (d !== 2) out.push({ value: "sayi: 2", label: "Sayı (2 hane)" });
  return out;
}

/** `data-each` değeri — kaynak YALNIZ `tablolar.*` dizilerinden. */
export function loopExpression(tableKey: string, variable = "satir"): string {
  return `${variable} in tablolar.${tableKey}`;
}

export function parseLoop(raw: string | undefined | null): { variable: string; tableKey: string } | null {
  const m = /^\s*([a-z_][a-z0-9_]*)\s+in\s+tablolar\.([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(raw ?? "");
  return m ? { variable: m[1]!, tableKey: m[2]! } : null;
}
