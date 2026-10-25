// =============================================================================
// PDF = Excel karşılaştırıcısı (TX) — `test_belge_excel_esit` (DB'siz) ve
// `test_belge_sablon_excel_esit` (servis yolu, DB'li) ORTAK kullanır.
// Görsel kalem tablosu üretimi panelin `itemTable.ts` kalıbının eşidir.
// =============================================================================
import { decodeAttrEntities } from "../../src/services/document-render/template-html.entities";
import type { DocNum } from "../../src/services/document-render/fmt-num";
import type { DocTableModel } from "../../src/services/document-render/doc-model";
import type { TableColumnDef, TableDef } from "../../src/services/document-template/sozlesme/tipler";

// ── Görsel kalem tablosu (panel `binding/itemTable.ts` + `directives.ts suggestFilters` ilk öneri) ──
export function defaultFilter(k: TableColumnDef): string {
  if (k.tur === "tarih" || k.tur === "tarih_saat" || k.tur === "takvim") return k.tur;
  if (k.tur === "para") return 'para: "TRY"';
  if (k.tur !== "sayi") return "";
  if (k.birim === "m") return "metre";
  if (k.birim === "kg") return "kg";
  return `sayi: ${k.ondalik ?? 0}`;
}
const q = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const filterAttr = (k: TableColumnDef) => (defaultFilter(k) ? ` data-filtre="${q(defaultFilter(k))}"` : "");

export function itemTableHtml(t: TableDef, keys: readonly string[]): string {
  const cols = keys.map((c) => t.kolonlar.find((k) => k.yol === c)!);
  const head = cols.map((k) => `<th data-kolon="${k.yol}">${q(k.etiket)}</th>`).join("");
  const body = cols.map((k) => `<td data-kolon="${k.yol}" data-alan="satir.${k.yol}"${filterAttr(k)}>x</td>`).join("");
  const foot = cols.some((k) => k.toplam)
    ? `<tfoot><tr>${cols
        .map((k, i) => (k.toplam ? `<td data-kolon="${k.yol}" data-alan="toplamlar.${k.toplam}"${filterAttr(k)}>Σ</td>` : `<td data-kolon="${k.yol}">${i === 0 ? "Toplam" : ""}</td>`))
        .join("")}</tr></tfoot>`
    : "";
  return `<table class="kalem-tablosu" data-tablo="${t.anahtar}"><thead><tr>${head}</tr></thead><tbody><tr data-each="satir in tablolar.${t.anahtar}">${body}</tr></tbody>${foot}</table>`;
}

/** Panel `collectTableBindings` eşi: `{ <tablo>: {kaynak, degisken, kolonlar} }`. */
export const bindingsOf = (layout: ReadonlyArray<[TableDef, string[]]>) =>
  Object.fromEntries(layout.map(([t, cols]) => [t.anahtar, { kaynak: `tablolar.${t.anahtar}`, degisken: "satir", kolonlar: cols }]));

// ── Basılan HTML'den tablo hücreleri ─────────────────────────────────────────────
export interface HtmlTable {
  head: Array<[string, string]>;
  rows: Array<Map<string, string>>;
  foot: Map<string, string> | null;
}
const text = (s: string) => (decodeAttrEntities(s.replace(/<[^>]*>/g, "")) ?? s).replace(/\s+/g, " ").trim();
const cellsOf = (tr: string, tag: "td" | "th") =>
  [...tr.matchAll(new RegExp(`<${tag}\\b[^>]*\\sdata-kolon="([^"]*)"[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => [m[1]!, text(m[2]!)] as [string, string]);

export function htmlTables(html: string): Map<string, HtmlTable> {
  const out = new Map<string, HtmlTable>();
  for (const t of html.matchAll(/<table\b[^>]*\sdata-tablo="([^"]+)"[^>]*>([\s\S]*?)<\/table>/g)) {
    const part = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(t[2]!)?.[1] ?? "";
    const trs = (s: string) => [...s.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!);
    const footTr = trs(part("tfoot"))[0];
    out.set(t[1]!, {
      head: cellsOf(trs(part("thead"))[0] ?? "", "th"),
      rows: trs(part("tbody")).map((tr) => new Map(cellsOf(tr, "td"))),
      foot: footTr === undefined ? null : new Map(cellsOf(footTr, "td")),
    });
  }
  return out;
}

/** Excel hücresi PDF metnini taşıyor mu: sayı aynı haneyle yeniden yazılır, birim eki atılır. */
export function sameCell(excel: string | number | null, pdf: string, kind: DocTableModel["columns"][number]["kind"], num: DocNum): boolean {
  if (excel == null) return pdf === "";
  if (typeof excel === "number" && kind.t === "num") return num.tr(excel, kind.dec) === pdf.replace(/ (m|kg|adet|[A-Z]{3})$/, "");
  return String(excel).replace(/\s+/g, " ").trim() === pdf;
}

/** Excel modeli ↔ basılan HTML. `hiddenInternal`: bağda olup Excel'e çıkmaması gereken iç kolonlar. */
export type Check = (label: string, ok: boolean, detail?: string) => void;

export function compareTable(where: string, m: DocTableModel, h: HtmlTable | undefined, extra: { num: DocNum; hiddenInternal: ReadonlySet<string>; check: Check }): void {
  const { check } = extra;
  if (!h) return check(`${where}: HTML'de tablo yok`, false);
  const htmlKeys = h.head.map(([k]) => k).filter((k) => !extra.hiddenInternal.has(k));
  check(`${where}: kolon kümesi/sırası`, JSON.stringify(m.columns.map((c) => c.key)) === JSON.stringify(htmlKeys), `excel=${m.columns.map((c) => c.key)} pdf=${htmlKeys}`);
  for (const c of m.columns) {
    const label = h.head.find(([k]) => k === c.key)?.[1];
    check(`${where}: başlık ${c.key}`, label === c.label, `excel="${c.label}" pdf="${label}"`);
  }
  check(`${where}: satır sayısı`, m.rows.length === h.rows.length, `excel=${m.rows.length} pdf=${h.rows.length}`);
  h.rows.forEach((row, i) => {
    for (const k of extra.hiddenInternal) check(`${where}: satır ${i} iç kolon ${k} PDF'te boş`, (row.get(k) ?? "") === "", row.get(k));
    m.columns.forEach((c, j) => {
      const pdf = row.get(c.key) ?? "<yok>";
      const xl = m.rows[i]?.[j] ?? null;
      check(`${where}: satır ${i} ${c.key}`, sameCell(xl, pdf, c.kind, extra.num), `excel=${JSON.stringify(xl)} pdf="${pdf}"`);
    });
  });
  if (!m.foot) return check(`${where}: toplam satırı`, !h.foot || ![...h.foot.values()].some((v) => v && v !== "Toplam"));
  m.columns.forEach((c, j) => {
    const xl = m.foot![j] ?? null;
    if (xl === "Toplam" || (xl === null && !h.foot?.get(c.key))) return;
    check(`${where}: toplam ${c.key}`, sameCell(xl, h.foot?.get(c.key) ?? "<yok>", m.footKinds![j]!, extra.num), `excel=${JSON.stringify(xl)} pdf="${h.foot?.get(c.key)}"`);
  });
}
