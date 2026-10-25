// =============================================================================
// BEKÇİ — Şablonlu belgede PDF = Excel (plan §3.8, TX)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_belge_excel_esit.ts   (§1–§3 DB'siz)
//
// Görsel kipteki kalem tablosu (`data-tablo` + `tr[data-each]` + `data-kolon` + `data-filtre`;
// panelin `itemTable.ts` kalıbı) motorla basılır; basılan HTML'in `data-kolon` hücreleri
// `buildBoundTables` (Excel modeli) ile kolon kümesi/sırası, başlık, satır sayısı ve hücre
// bakımından karşılaştırılır. Sayı hücresi: Excel değeri aynı haneyle yeniden yazılınca PDF
// metnine (birim eki atılmış) BAYT-EŞİT olmalı.
//   §1 tüm sözleşmeler × tüm senaryolar: müşteri kolonları sözleşme sırasıyla
//   §2 kolon gizlenmiş + sıra ters çevrilmiş bağ → Excel bağ sırasını izler
//   §3 iç kolon: opt-in'de iki tarafta da var; opt-in yokken bağda dursa da Excel'e ÇIKMAZ
//      (PDF onu basamaz: `insa` alanı koymaz, katı motor "Tanımsız alan" der — editör kilitler)
//
// ⭐ NEGATİF SONDALAR (2026-10-25, ölçüldü; dosya md5 ile geri kondu):
//   (a) üretici bağ sırasını yok sayıp sözleşme sırasına dizdi → ≥40 ❌ (§2)
//   (b) iç kolonun opt-in kapısı kaldırıldı → 16 ❌ (§3)
//   (c) üretici son kolonu atladı → ≥40 ❌ (§1)
// =============================================================================
import { decodeAttrEntities } from "../src/services/document-render/template-html.entities";
import { docNum, type DocNum } from "../src/services/document-render/fmt-num";
import type { DocTableModel } from "../src/services/document-render/doc-model";
import { renderTemplate } from "../src/services/document-template/motor/render";
import { buildBoundTables, readColumnFilters, readTableBindings } from "../src/services/document-template/excel-tables";
import { listContracts, type RegisteredContract } from "../src/services/document-template/sozlesme/kayit";
import type { Scenario, TableColumnDef, TableDef, TemplateContext } from "../src/services/document-template/sozlesme/tipler";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else {
    fail++;
    if (failures.length < 40) failures.push(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Görsel kalem tablosu (panel `binding/itemTable.ts` + `directives.ts suggestFilters` ilk öneri) ──
function defaultFilter(k: TableColumnDef): string {
  if (k.tur === "tarih" || k.tur === "tarih_saat" || k.tur === "takvim") return k.tur;
  if (k.tur === "para") return 'para: "TRY"';
  if (k.tur !== "sayi") return "";
  if (k.birim === "m") return "metre";
  if (k.birim === "kg") return "kg";
  return `sayi: ${k.ondalik ?? 0}`;
}
const q = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const filterAttr = (k: TableColumnDef) => (defaultFilter(k) ? ` data-filtre="${q(defaultFilter(k))}"` : "");

function itemTableHtml(t: TableDef, keys: readonly string[]): string {
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
const bindingsOf = (layout: ReadonlyArray<[TableDef, string[]]>) =>
  Object.fromEntries(layout.map(([t, cols]) => [t.anahtar, { kaynak: `tablolar.${t.anahtar}`, degisken: "satir", kolonlar: cols }]));

// ── Basılan HTML'den tablo hücreleri ─────────────────────────────────────────────
interface HtmlTable {
  head: Array<[string, string]>;
  rows: Array<Map<string, string>>;
  foot: Map<string, string> | null;
}
const text = (s: string) => (decodeAttrEntities(s.replace(/<[^>]*>/g, "")) ?? s).replace(/\s+/g, " ").trim();
const cellsOf = (tr: string, tag: "td" | "th") =>
  [...tr.matchAll(new RegExp(`<${tag}\\b[^>]*\\sdata-kolon="([^"]*)"[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => [m[1]!, text(m[2]!)] as [string, string]);

function htmlTables(html: string): Map<string, HtmlTable> {
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
function sameCell(excel: string | number | null, pdf: string, kind: DocTableModel["columns"][number]["kind"], num: DocNum): boolean {
  if (excel == null) return pdf === "";
  if (typeof excel === "number" && kind.t === "num") return num.tr(excel, kind.dec) === pdf.replace(/ (m|kg|adet|[A-Z]{3})$/, "");
  return String(excel).replace(/\s+/g, " ").trim() === pdf;
}

/** Excel modeli ↔ basılan HTML. `hiddenInternal`: bağda olup Excel'e çıkmaması gereken iç kolonlar. */
function compareTable(where: string, m: DocTableModel, h: HtmlTable | undefined, extra: { num: DocNum; hiddenInternal: ReadonlySet<string> }): void {
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

// ── Koşucu: aynı bağlamdan PDF (motor) ve Excel (üretici) ─────────────────────────
interface Case {
  contract: RegisteredContract;
  scn: Scenario<unknown, unknown>;
  layout: Array<[TableDef, string[]]>;
  internalFields: string[];
  /** Excel bağı PDF'tekinden farklıysa (§3: kilitli iç kolon bağda kalmış; motor onu basamaz). */
  excelLayout?: Array<[TableDef, string[]]>;
}
function runCase(where: string, c: Case): DocTableModel[] {
  const sourceHtml = c.layout.map(([t, cols]) => itemTableHtml(t, cols)).join("\n");
  const ayar = c.contract.ayarNormalize({});
  const context = c.contract.insa(c.scn.snapshot, ayar, c.internalFields, c.scn.ek) as TemplateContext;
  const snapshot = c.scn.snapshot as { numberRounding?: unknown };
  const out = renderTemplate({ editMode: "VISUAL", sourceHtml, css: "", pageSettings: {} }, { context: context as never, snapshot: snapshot as never, overlay: null });
  check(`${where}: temizleyici parça kesmedi`, out.removed.length === 0, out.removed.join(","));
  const num = docNum(snapshot);
  const models = buildBoundTables({
    contract: c.contract,
    context,
    bindings: readTableBindings(bindingsOf(c.excelLayout ?? c.layout)),
    filters: readColumnFilters(sourceHtml),
    internalFields: c.internalFields,
    num,
  });
  const html = htmlTables(out.html);
  const optIn = new Set(c.internalFields);
  for (const [t, cols] of c.excelLayout ?? c.layout) {
    const hiddenInternal = new Set(cols.filter((k) => t.kolonlar.find((d) => d.yol === k && d.sinif === "ic" && !optIn.has(d.icKod ?? ""))));
    const m = models.find((x) => x.key === t.anahtar);
    if (!m) {
      check(`${where} · ${t.anahtar}: Excel'de tablo yok`, cols.every((k) => hiddenInternal.has(k)));
      continue;
    }
    compareTable(`${where} · ${t.anahtar}`, m, html.get(t.anahtar), { num, hiddenInternal });
  }
  return models;
}

const customerCols = (t: TableDef) => t.kolonlar.filter((k) => k.sinif === "musteri").map((k) => k.yol);
const contracts = listContracts().filter((c) => c.tablolar.length > 0);

console.log(`\n🧪 PDF = Excel (şablonlu belge) — ${contracts.length} sözleşme\n`);
console.log("§1 tüm sözleşmeler × senaryolar: müşteri kolonları");
for (const contract of contracts) {
  for (const scn of contract.senaryolar() as Scenario<unknown, unknown>[]) {
    const layout = contract.tablolar.map((t) => [t, customerCols(t)] as [TableDef, string[]]).filter(([, cols]) => cols.length > 0);
    runCase(`§1 ${contract.docType} · ${scn.ad}`, { contract, scn, layout, internalFields: [] });
  }
}

console.log("§2 kolon gizlenmiş + sıra ters bağ → Excel bağ sırasını izler");
for (const contract of contracts) {
  const scn = contract.senaryolar()[0] as Scenario<unknown, unknown>;
  const layout = contract.tablolar
    .map((t) => [t, customerCols(t).slice(1).reverse()] as [TableDef, string[]])
    .filter(([, cols]) => cols.length > 1);
  if (!layout.length) continue;
  const models = runCase(`§2 ${contract.docType}`, { contract, scn, layout, internalFields: [] });
  for (const [t, cols] of layout) {
    const m = models.find((x) => x.key === t.anahtar);
    check(`§2 ${contract.docType} · ${t.anahtar}: Excel kolonları = bağ sırası`, JSON.stringify(m?.columns.map((c) => c.key)) === JSON.stringify(cols), `${m?.columns.map((c) => c.key)}`);
  }
}

console.log("§3 iç kolon: opt-in ↔ opt-in'siz");
let internalCases = 0;
for (const contract of contracts) {
  const withInternal = contract.tablolar.filter((t) => t.kolonlar.some((k) => k.sinif === "ic"));
  if (!withInternal.length) continue;
  const scn = contract.senaryolar()[0] as Scenario<unknown, unknown>;
  const layout = withInternal.map((t) => [t, t.kolonlar.map((k) => k.yol)] as [TableDef, string[]]);
  const codes = withInternal.flatMap((t) => t.kolonlar.filter((k) => k.sinif === "ic" && k.icKod).map((k) => k.icKod!));
  internalCases++;
  const open = runCase(`§3 ${contract.docType} · opt-in`, { contract, scn, layout, internalFields: codes });
  const pdfLayout = withInternal.map((t) => [t, customerCols(t)] as [TableDef, string[]]);
  const closed = runCase(`§3 ${contract.docType} · opt-in yok`, { contract, scn, layout: pdfLayout, internalFields: [], excelLayout: layout });
  for (const t of withInternal) {
    const ic = t.kolonlar.filter((k) => k.sinif === "ic").map((k) => k.yol);
    const keys = (ms: DocTableModel[]) => ms.find((x) => x.key === t.anahtar)?.columns.map((c) => c.key) ?? [];
    check(`§3 ${contract.docType} · ${t.anahtar}: opt-in iç kolon Excel'de`, ic.every((k) => keys(open).includes(k)), `${keys(open)}`);
    check(`§3 ${contract.docType} · ${t.anahtar}: opt-in'siz iç kolon Excel'e SIZMAZ`, ic.every((k) => !keys(closed).includes(k)), `${keys(closed)}`);
  }
}
check("§3 iç kolonlu en az bir sözleşme ölçüldü (körlük zemini)", internalCases > 0);

for (const f of failures) console.log(f);
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail ? 1 : 0);
