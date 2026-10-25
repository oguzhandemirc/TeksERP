/**
 * Kalem tablosu: sözleşme tablosu + seçili kolonlar → yönergeli HTML, ve kanvastaki
 * tablolardan `tableBindings`. `data-each` `tr` üzerinde durur (plan §5); başlık/hücre
 * `data-kolon` taşır ki kolon ekle/çıkar/sırala tabloyu yeniden kurabilsin.
 */
import { isFieldLocked, sampleText, type ContractColumn, type ContractTable } from "./contract";
import { loopExpression, parseLoop, suggestFilters } from "./directives";

export const ITEM_TABLE_CLASS = "kalem-tablosu";
export const ROW_VARIABLE = "satir";

export const ITEM_TABLE_CSS =
  `.${ITEM_TABLE_CLASS}{width:100%;border-collapse:collapse;font-size:9pt;}` +
  `.${ITEM_TABLE_CLASS} th,.${ITEM_TABLE_CLASS} td{border:0.25mm solid #444444;padding:1mm 1.5mm;text-align:left;}` +
  `.${ITEM_TABLE_CLASS} th{background-color:#eeeeee;}` +
  `.${ITEM_TABLE_CLASS} .hiza-r{text-align:right;}.${ITEM_TABLE_CLASS} .hiza-c{text-align:center;}`;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Varsayılan kolonlar: müşteri sınıfı, en çok 6; iç kolon yalnız opt-in ise. */
export function defaultColumns(t: ContractTable, internalFields: readonly string[]): string[] {
  return t.kolonlar.filter((k) => !isFieldLocked(k, internalFields)).slice(0, 6).map((k) => k.yol);
}

export function columnFilter(k: ContractColumn): string {
  return suggestFilters(k.tur, { ondalik: k.ondalik, birim: k.birim })[0]?.value ?? "";
}

const alignClass = (k: ContractColumn): string => (k.hiza === "r" ? ' class="hiza-r"' : k.hiza === "c" ? ' class="hiza-c"' : "");

function cell(k: ContractColumn): string {
  const filter = columnFilter(k);
  const f = filter ? ` data-filtre="${esc(filter)}"` : "";
  return `<td data-kolon="${k.yol}"${alignClass(k)} data-alan="${ROW_VARIABLE}.${k.yol}"${f}>${esc(sampleText(k, k.etiket))}</td>`;
}

function footCell(k: ContractColumn, first: boolean): string {
  if (k.toplam) {
    const filter = columnFilter(k);
    const f = filter ? ` data-filtre="${esc(filter)}"` : "";
    return `<td data-kolon="${k.yol}"${alignClass(k)} data-alan="toplamlar.${k.toplam}"${f}>Σ</td>`;
  }
  return `<td data-kolon="${k.yol}"${alignClass(k)}>${first ? "Toplam" : ""}</td>`;
}

/** Tablonun İÇ HTML'i (thead + tbody + gerekirse tfoot) — tablo öğesinin öznitelikleri korunur. */
export function itemTableInner(t: ContractTable, columns: readonly string[]): string {
  const cols = columns.map((c) => t.kolonlar.find((k) => k.yol === c)).filter((k): k is ContractColumn => !!k);
  const head = cols.map((k) => `<th data-kolon="${k.yol}"${alignClass(k)}>${esc(k.etiket)}</th>`).join("");
  const body = cols.map(cell).join("");
  const hasTotal = cols.some((k) => k.toplam);
  const foot = hasTotal ? `<tfoot><tr>${cols.map((k, i) => footCell(k, i === 0)).join("")}</tr></tfoot>` : "";
  return `<thead><tr>${head}</tr></thead><tbody><tr data-each="${loopExpression(t.anahtar, ROW_VARIABLE)}">${body}</tr></tbody>${foot}`;
}

export function itemTableHtml(t: ContractTable, columns: readonly string[]): string {
  return `<table class="${ITEM_TABLE_CLASS}" data-tablo="${t.anahtar}">${itemTableInner(t, columns)}</table>`;
}

/** Kolon sırasını taşı (yukarı −1 / aşağı +1); sınırda değişmez. */
export function moveColumn(columns: readonly string[], key: string, dir: -1 | 1): string[] {
  const i = columns.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= columns.length) return [...columns];
  const next = [...columns];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Kolonu aç/kapa: kapatılan çıkar, açılan sözleşme sırasındaki yerine girer. */
export function toggleColumn(t: ContractTable, columns: readonly string[], key: string): string[] {
  if (columns.includes(key)) return columns.filter((c) => c !== key);
  const order = t.kolonlar.map((k) => k.yol);
  return [...columns, key].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export interface TableBinding {
  kaynak: string;
  degisken: string;
  kolonlar: string[];
}

/** Kanvas DOM'undaki kalem tabloları → `tableBindings` (`{ <tablo>: {kaynak, degisken, kolonlar} }`). */
export function collectTableBindings(root: ParentNode): Record<string, TableBinding> {
  const out: Record<string, TableBinding> = {};
  for (const table of Array.from(root.querySelectorAll("table[data-tablo]"))) {
    const row = table.querySelector("tr[data-each]");
    const loop = parseLoop(row?.getAttribute("data-each"));
    const key = table.getAttribute("data-tablo") ?? "";
    if (!loop || !key) continue;
    const cols = Array.from(row!.querySelectorAll(":scope > [data-kolon]")).map((c) => c.getAttribute("data-kolon") ?? "");
    out[key] = { kaynak: `tablolar.${loop.tableKey}`, degisken: loop.variable, kolonlar: cols.filter(Boolean) };
  }
  return out;
}

/** HTML metninden `tableBindings` (editör `getHtml()` çıktısı). */
export function tableBindingsFromHtml(html: string): Record<string, TableBinding> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return collectTableBindings(doc.body);
}
