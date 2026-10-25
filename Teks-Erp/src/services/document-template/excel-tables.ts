// =============================================================================
// Şablonlu belgenin Excel tabloları (plan §3.8, TX — "PDF = Excel")
// =============================================================================
// Görsel kipte kalem tablosu kolonları sürümün `tableBindings`'inden (anahtar + sıra),
// hücre biçimi kaynaktaki `data-filtre`den gelir; değerler PDF'in bağlamıyla (`insa`)
// AYNIDIR ve `resolveDocTable` → `excelValue` ile PDF'te basılan haneye yuvarlanır.
// İç kolon yalnız `internalFields` opt-in'iyle çıkar (bağda dursa da). Bağı olmayan
// sürümde (CODE kip) Sistem tabloları kullanılır: eşlenik ≡ Sistem (`test_belge_sistem_esdegeri`).
// Bekçi: `scripts/test_belge_excel_esit.ts`.
// =============================================================================

import { resolveDocTable, type DocCellKind, type DocCellValue, type DocColSpec, type DocTableModel } from "../document-render/doc-model";
import type { DocNum } from "../document-render/fmt-num";
import { CUSTOM_FILTERS } from "./motor/filtreler";
import type { ContextObject, ContextValue, TableColumnDef, TemplateContext } from "./sozlesme/tipler";
import type { RegisteredContract } from "./sozlesme/kayit";

/** Bağı olmayan şablonlu belgede `/tables` uyarısı (editör kaydında da döner). */
export const EXCEL_DEFAULT_COLUMNS_WARNING =
  "Excel varsayılan kolonlarla üretildi: şablonda kalem tablosu bağı yok (kod kipi); PDF'teki tablo düzeni Excel'e yansımayabilir.";

/** Sürümdeki tek kalem tablosu bağı: `data-tablo` anahtarı, sözleşme tablosu, kolon sırası. */
export interface BoundTable {
  key: string;
  table: string;
  columns: string[];
}

/** tablo (`data-tablo`) → kolon (`data-kolon`) → gövde hücresinin `data-filtre`si. */
export type ColumnFilters = Map<string, Map<string, string>>;

/** `tableBindings` (`{ <tablo>: {kaynak, degisken, kolonlar} }`) → sıralı bağlar; bozuk girdi atlanır. */
export function readTableBindings(raw: unknown): BoundTable[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: BoundTable[] = [];
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const b = v as { kaynak?: unknown; kolonlar?: unknown };
    const source = typeof b.kaynak === "string" && b.kaynak.startsWith("tablolar.") ? b.kaynak.slice("tablolar.".length) : key;
    const columns = Array.isArray(b.kolonlar) ? b.kolonlar.filter((c): c is string => typeof c === "string" && c !== "") : [];
    out.push({ key, table: source, columns });
  }
  return out;
}

const decodeAttr = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeAttr(m[1]!) : null;
};

/** Kaynak HTML'deki kalem tablolarının satır hücresi filtreleri (`tr[data-each] > td[data-kolon]`). */
export function readColumnFilters(sourceHtml: string): ColumnFilters {
  const out: ColumnFilters = new Map();
  for (const t of sourceHtml.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/g)) {
    const key = attrOf(t[1]!, "data-tablo");
    const row = /<tr\b[^>]*\sdata-each="[^"]*"[^>]*>([\s\S]*?)<\/tr>/.exec(t[2]!);
    if (!key || !row) continue;
    const cols = new Map<string, string>();
    for (const td of row[1]!.matchAll(/<td\b[^>]*>/g)) {
      const col = attrOf(td[0], "data-kolon");
      if (col) cols.set(col, attrOf(td[0], "data-filtre") ?? "");
    }
    out.set(key, cols);
  }
  return out;
}

interface CellRule {
  kind: DocCellKind;
  value: (v: ContextValue | undefined) => DocCellValue;
}

const toNum = (v: ContextValue | undefined): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const raw = (v: ContextValue | undefined): DocCellValue =>
  v == null ? null : typeof v === "number" || typeof v === "string" ? v : typeof v === "boolean" ? String(v) : null;
const intArg = (arg: string, fallback: number): number => (/^\d$/.test(arg) ? Number(arg) : fallback);
const unquote = (s: string): string => s.replace(/^["']|["']$/g, "");
const DATE_FILTERS = new Set(["tarih", "tarih_saat", "takvim", "saat"]);
const NUM_FILTER_DEFAULT_DEC: Readonly<Record<string, number>> = { sayi: 2, metre: 2, kg: 2, adet: 0 };

/** Hücrenin filtresi → Excel türü/değeri; filtre motorun (`motor/filtreler.ts`) yazımıyla AYNI haneyi taşır. */
function cellRule(filter: string): CellRule {
  const i = filter.indexOf(":");
  const name = (i < 0 ? filter : filter.slice(0, i)).trim();
  const arg = i < 0 ? "" : filter.slice(i + 1).trim();
  const numDec = NUM_FILTER_DEFAULT_DEC[name];
  if (numDec !== undefined) return { kind: { t: "num", dec: intArg(arg, numDec) }, value: toNum };
  // `para` boş değeri "—" (+ birim) basar; Excel de aynı metni taşır.
  if (name === "para") {
    const empty = arg ? `— ${unquote(arg)}` : "—";
    return { kind: { t: "num", dec: 2 }, value: (v) => toNum(v) ?? (v == null || v === "" ? empty : raw(v)) };
  }
  if (DATE_FILTERS.has(name)) {
    const fn = CUSTOM_FILTERS[name] as unknown as (v: unknown) => unknown;
    return { kind: { t: "text" }, value: (v) => String(fn(v) ?? "") };
  }
  if (name === "upcase") return { kind: { t: "text" }, value: (v) => (v == null ? null : String(raw(v)).toUpperCase()) };
  if (name === "default") return { kind: { t: "text" }, value: (v) => (v == null || v === "" || v === false ? unquote(arg) : raw(v)) };
  return { kind: { t: "text" }, value: raw };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** İç kolon yalnız opt-in ise; bilinmeyen kolon (sözleşmede yok) atlanır. */
function visibleColumns(defs: readonly TableColumnDef[], keys: readonly string[], optIn: ReadonlySet<string>): TableColumnDef[] {
  return keys
    .map((k) => defs.find((d) => d.yol === k))
    .filter((d): d is TableColumnDef => !!d && (d.sinif === "musteri" || (!!d.icKod && optIn.has(d.icKod))));
}

export interface BoundTablesInput {
  contract: RegisteredContract;
  context: TemplateContext;
  bindings: readonly BoundTable[];
  filters: ColumnFilters;
  internalFields: readonly string[];
  num: DocNum;
}

/** Görsel kipteki kalem tablolarının Excel modeli — bağ sırasıyla, PDF bağlamından. */
export function buildBoundTables(input: BoundTablesInput): DocTableModel[] {
  const optIn = new Set(input.internalFields);
  const out: DocTableModel[] = [];
  // Tablo sırası kaynaktaki yerinden: `tableBindings` jsonb'de durur, jsonb anahtar sırasını korumaz.
  const pos = new Map([...input.filters.keys()].map((k, i) => [k, i]));
  const ordered = [...input.bindings].sort((a, b) => (pos.get(a.key) ?? Infinity) - (pos.get(b.key) ?? Infinity));
  for (const b of ordered) {
    const def = input.contract.tablolar.find((t) => t.anahtar === b.table);
    if (!def) continue;
    const cols = visibleColumns(def.kolonlar, b.columns, optIn);
    if (!cols.length) continue;
    const filters = input.filters.get(b.key) ?? new Map<string, string>();
    const specs: DocColSpec<ContextObject>[] = cols.map((c) => {
      const rule = cellRule(filters.get(c.yol) ?? "");
      return {
        key: c.yol,
        label: esc(c.etiket),
        align: c.hiza,
        kind: rule.kind,
        value: (r) => rule.value(r[c.yol]),
        ...(c.toplam ? { foot: { value: rule.value(input.context.toplamlar[c.toplam]) } } : {}),
      };
    });
    out.push(
      resolveDocTable({
        key: b.key,
        caption: esc(def.etiket),
        cols: specs,
        rows: input.context.tablolar[b.table] ?? [],
        footLabel: "Toplam",
        kit: { esc: (v) => (v == null ? "" : esc(String(v))), fmtTr: (n, dec) => input.num.tr(n, dec) },
      }),
    );
  }
  return out;
}
