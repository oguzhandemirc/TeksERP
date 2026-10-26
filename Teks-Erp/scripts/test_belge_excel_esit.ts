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
//   (her vakada) bağ nesnesi ters anahtar sırasıyla verilir → tablo sırası kaynaktaki yerinden
//   §3 iç kolon: opt-in'de iki tarafta da var; opt-in yokken bağda dursa da Excel'e ÇIKMAZ
//      (PDF onu basamaz: `insa` alanı koymaz, katı motor "Tanımsız alan" der — editör kilitler)
//
// ⭐ NEGATİF SONDALAR (2026-10-25, ölçüldü; dosya md5 ile geri kondu):
//   (a) üretici bağ sırasını yok sayıp sözleşme sırasına dizdi → ≥40 ❌ (§2)
//   (b) iç kolonun opt-in kapısı kaldırıldı → 16 ❌ (§3)
//   (c) üretici son kolonu atladı → ≥40 ❌ (§1)
//   (d) tablo sırası bağ nesnesinden okundu (kaynaktan değil) → 104 ❌
// =============================================================================
import { docNum } from "../src/services/document-render/fmt-num";
import { bindingsOf, compareTable, htmlTables, itemTableHtml } from "./lib/belge-excel-karsilastir";
import type { DocTableModel } from "../src/services/document-render/doc-model";
import { renderTemplate } from "../src/services/document-template/motor/render";
import { buildBoundTables, readColumnFilters, readTableBindings } from "../src/services/document-template/excel-tables";
import { listContracts, type RegisteredContract } from "../src/services/document-template/sozlesme/kayit";
import type { Scenario, TableDef, TemplateContext } from "../src/services/document-template/sozlesme/tipler";

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
    // Bağ nesnesi TERS sırayla: jsonb anahtar sırasını korumaz, tablo sırası kaynaktan gelmeli.
    bindings: readTableBindings(bindingsOf([...(c.excelLayout ?? c.layout)].reverse())),
    filters: readColumnFilters(sourceHtml),
    internalFields: c.internalFields,
    num,
  });
  const html = htmlTables(out.html);
  const htmlOrder = [...html.keys()].filter((k) => models.some((m) => m.key === k));
  check(`${where}: tablo sırası kaynaktaki gibi`, JSON.stringify(models.map((m) => m.key)) === JSON.stringify(htmlOrder), `${models.map((m) => m.key)}`);
  const optIn = new Set(c.internalFields);
  for (const [t, cols] of c.excelLayout ?? c.layout) {
    const hiddenInternal = new Set(cols.filter((k) => t.kolonlar.find((d) => d.yol === k && d.sinif === "ic" && !optIn.has(d.icKod ?? ""))));
    const m = models.find((x) => x.key === t.anahtar);
    if (!m) {
      check(`${where} · ${t.anahtar}: Excel'de tablo yok`, cols.every((k) => hiddenInternal.has(k)));
      continue;
    }
    compareTable(`${where} · ${t.anahtar}`, m, html.get(t.anahtar), { num, hiddenInternal, check });
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
process.exitCode = fail ? 1 : 0;
