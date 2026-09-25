// =============================================================================
// Bekçi: ÇEK TESLİM BORDROSUNUN PDF'İ İLE EXCEL'İ AYNI İÇERİĞİ TAŞIR — DB gerekmez
// Çalıştır: npx tsx scripts/test_cek_bordro_excel_esit.ts
// =============================================================================
// Kullanıcı kuralı (`docs/kurallar/belge-etiket.md`): aynı belgenin PDF'i ve Excel'i
// aynı kolon/değer çözücüsünden türer. K1 (2026-09-26) öncesinde anlık bordronun
// Excel'i panelde ELLE kurulmuş ikinci bir kolon listesinden geliyordu ve şablonun
// `columns.chequeTable` ayarı ona hiç uygulanmıyordu.
//
// Ölçüm: fikstürün (`lib/cek-bordro-fikstur.ts`) her kombinasyonunda HTML
// ayrıştırılır ve aynı belgenin `renderChequeDeliveryNoteTables` modeliyle
// karşılaştırılır — çek tablosu (başlık · kolon başlıkları ve sırası · satır sayısı ·
// HER HÜCRE · toplam satırı), başlık bloğu (başlık · filigran · belge no · tarih ·
// taraf satırları · not), ara toplam kutusu ve beyan. Excel değeri PDF metnine
// renderer'dan BAĞIMSIZ bir biçimleyiciyle çevrilir.
// =============================================================================
import { renderChequeDeliveryNoteHtml, renderChequeDeliveryNoteTables } from "../src/services/document-render/finance-doc.html";
import type { DocCellKind, DocCellValue } from "../src/services/document-render/doc-model";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { cekBordroKombinasyonlari } from "./lib/cek-bordro-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

/** HTML kaçışı — renderer'ınkinden bağımsız yazıldı (aynı beş karakter). */
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** TR sayı biçimi — renderer'dan bağımsız: binlik ".", ondalık ",". */
function trNum(n: number, dec: number): string {
  const [int, frac] = Math.abs(n).toFixed(dec).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "-" : "") + grouped + (frac ? `,${frac}` : "");
}

/** Excel hücresi PDF'te nasıl okunur — değer + tür → görünen metin. */
function asPdfText(kind: DocCellKind, v: DocCellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return esc(v);
  if (kind.t === "text") return esc(String(v));
  const body = kind.t === "int" ? String(v) : trNum(v, kind.dec);
  return body + (kind.suffix ?? "");
}

const normalizeHtml = (html: string) => html.replace(/\s+/g, " ").trim();

interface HtmlTable {
  caption: string;
  headers: string[];
  rows: string[][];
  foot: string[] | null;
}

function parseTables(html: string): HtmlTable[] {
  const out: HtmlTable[] = [];
  for (const m of html.matchAll(/<table class="sec[^"]*">([\s\S]*?)<\/table>/g)) {
    const body = m[1]!;
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(body)?.[1] ?? "";
    const caption = /<th class="caption"[^>]*>([\s\S]*?)<\/th>/.exec(thead)?.[1] ?? "";
    const headRows = [...thead.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => r[1]!).filter((r) => !r.includes('class="caption"'));
    const headers = [...(headRows.at(-1) ?? "").matchAll(/<th class="[lrc]"[^>]*>([\s\S]*?)<\/th>/g)].map((x) => x[1]!);
    const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(body)?.[1] ?? "";
    const rows: string[][] = [];
    let foot: string[] | null = null;
    for (const r of tbody.matchAll(/<tr( class="tot")?>([\s\S]*?)<\/tr>/g)) {
      const cells = [...r[2]!.matchAll(/<td class="[^"]*">([\s\S]*?)<\/td>/g)].map((x) => x[1]!);
      if (r[1]) foot = cells;
      else rows.push(cells);
    }
    out.push({ caption, headers, rows, foot });
  }
  return out;
}

/** Başlık bloğu + kutular — PDF'te etiket/değer çifti olarak görünen her şey. */
function parsePairs(html: string): string[] {
  const ln = [...html.matchAll(/<div class="ln">([^<:]*): <b>([^<]*)<\/b><\/div>/g)].map((m) => `${m[1]}=${m[2]}`);
  const rows = [...html.matchAll(/<div class="row"><span>([^<]*):<\/span><b>([^<]*)<\/b><\/div>/g)].map((m) => `${m[1]}=${m[2]}`);
  return [...ln, ...rows].sort();
}

const kombinasyonlar = cekBordroKombinasyonlari();
let tablo = 0;
let hucre = 0;
let cift = 0;
const gorulenBaslik = new Set<string>();
const hatalar: string[] = [];

for (const k of kombinasyonlar) {
  const html = normalizeHtml(renderChequeDeliveryNoteHtml(k.snapshot, k.meta));
  const model = renderChequeDeliveryNoteTables(k.snapshot, k.meta);
  const yer = k.ad;

  // ── Tablo ──
  const htmlTables = parseTables(html);
  const modelTables = model.tables.filter((t) => t.columns.length > 0);
  if (htmlTables.length !== modelTables.length) {
    hatalar.push(`${yer}: tablo sayısı PDF ${htmlTables.length} ≠ Excel ${modelTables.length}`);
  } else {
    modelTables.forEach((mt, ti) => {
      const ht = htmlTables[ti]!;
      tablo++;
      if (ht.caption !== esc(mt.caption)) hatalar.push(`${yer}: tablo başlığı ${ht.caption} ≠ ${mt.caption}`);
      const modelHeaders = mt.columns.map((c) => esc(c.label));
      if (ht.headers.join("|") !== modelHeaders.join("|")) {
        hatalar.push(`${yer}: kolonlar PDF [${ht.headers.join(", ")}] ≠ Excel [${modelHeaders.join(", ")}]`);
        return;
      }
      mt.columns.forEach((c) => gorulenBaslik.add(c.label));
      if (ht.rows.length !== mt.rows.length) {
        hatalar.push(`${yer}: satır sayısı PDF ${ht.rows.length} ≠ Excel ${mt.rows.length}`);
        return;
      }
      mt.rows.forEach((row, ri) => {
        if (row.length !== ht.rows[ri]!.length) hatalar.push(`${yer} satır ${ri + 1}: hücre sayısı PDF ${ht.rows[ri]!.length} ≠ Excel ${row.length}`);
        row.forEach((v, ci) => {
          hucre++;
          const beklenen = asPdfText(mt.columns[ci]!.kind, v);
          const pdf = ht.rows[ri]![ci];
          if (pdf !== beklenen) hatalar.push(`${yer} satır ${ri + 1} "${mt.columns[ci]!.label}": PDF "${pdf}" ≠ Excel "${beklenen}"`);
        });
      });
      const htmlFoot = ht.foot?.join("|") ?? null;
      const modelFoot = mt.foot ? mt.foot.map((v, ci) => asPdfText(mt.footKinds?.[ci] ?? mt.columns[ci]!.kind, v)).join("|") : null;
      if (htmlFoot !== modelFoot) hatalar.push(`${yer}: toplam PDF ${htmlFoot} ≠ Excel ${modelFoot}`);
    });
  }

  // ── Başlık bloğu: filigran + başlık + etiket/değer çiftleri (not kutusu dahil) ──
  const wm = /<div class="wm[^"]*">([^<]*)<\/div>/.exec(html)?.[1] ?? null;
  const baslik = /<div class="title">([^<]*)<\/div>/.exec(html)?.[1] ?? null;
  const tekHucre = model.header.filter(([, v]) => v == null).map(([l]) => esc(l));
  const beklenenTek = [...(wm ? [wm] : []), baslik!, ...(k.snapshot.company?.name ? [esc(k.snapshot.company.name)] : [])];
  if (tekHucre.join("|") !== beklenenTek.join("|")) hatalar.push(`${yer}: başlık satırları PDF [${beklenenTek.join(", ")}] ≠ Excel [${tekHucre.join(", ")}]`);

  const notSatiri = model.notes.find((n) => n.startsWith("Not: "));
  const modelCiftler = [
    ...model.header.filter(([, v]) => v != null).map(([l, v]) => `${esc(l)}=${esc(v!)}`),
    ...(notSatiri ? [`Not=${esc(notSatiri.slice(5))}`] : []),
  ].sort();
  const pdfCiftler = parsePairs(html);
  cift += pdfCiftler.length;
  if (pdfCiftler.join("|") !== modelCiftler.join("|")) hatalar.push(`${yer}: çiftler PDF [${pdfCiftler.join(", ")}] ≠ Excel [${modelCiftler.join(", ")}]`);

  // ── Ara toplam kutusu ↔ Excel dipnotları ──
  // Kutu satırının etiketi iki noktasızdır ("TRY (2 adet)"); taraf/not satırları "Etiket:" taşır.
  const kutuSatir = [...html.matchAll(/<div class="row"><span>([^<]*[^<:])<\/span><b>([^<]*)<\/b><\/div>/g)].map((m) => `${m[1]}: ${m[2]}`);
  const modelKutu = model.notes.filter((n) => /^[A-Z]{3} \(\d+ adet\): /.test(n)).map(esc);
  if (kutuSatir.join("|") !== modelKutu.join("|")) hatalar.push(`${yer}: ara toplam PDF [${kutuSatir.join(", ")}] ≠ Excel [${modelKutu.join(", ")}]`);

  // ── Beyan ──
  const beyan = /<div class="decl">([^<]*)<\/div>/.exec(html)?.[1] ?? null;
  const modelBeyan = model.notes.filter((n) => n.startsWith("Aşağıda dökümü") || n.startsWith("Listede birden") || n.startsWith("İki nüsha"));
  const beyanModel = modelBeyan.length ? esc(modelBeyan.join(" ")) : null;
  if (beyan !== beyanModel) hatalar.push(`${yer}: beyan PDF "${beyan}" ≠ Excel "${beyanModel}"`);
}

console.log("§1 Körlük zemini");
check("kombinasyon ≥ 250", kombinasyonlar.length >= 250, `${kombinasyonlar.length}`);
check("karşılaştırılan tablo ≥ 180", tablo >= 180, `${tablo}`);
check("karşılaştırılan hücre ≥ 4.000", hucre >= 4_000, `${hucre}`);
check("karşılaştırılan etiket/değer çifti ≥ 500", cift >= 500, `${cift}`);
for (const b of ["SIRA", "BELGE NO", "SERİ NO", "KEŞİDE", "VADE", "KEŞİDECİ", "BANKA", "PARA", "TUTAR", "ÇEK <#>", "TUTAR & TL", ""]) {
  check(`uzayda "${b}" kolon başlığı ölçüldü`, gorulenBaslik.has(b));
}

console.log("§2 ⭐ Her kombinasyonda PDF = Excel (tablo · başlık bloğu · ara toplam · beyan)");
check(`${kombinasyonlar.length} kombinasyonda fark yok`, hatalar.length === 0, hatalar.length ? `${hatalar.length} fark:\n      ${hatalar.slice(0, 10).join("\n      ")}` : "");

console.log("§3 Excel'in değer türleri PDF'in bastığını taşır");
const tek = cekBordroKombinasyonlari().find((k) => k.ad === "tekPara/bos/yok")!;
const t = renderChequeDeliveryNoteTables(tek.snapshot, {}).tables[0]!;
const col = (key: string) => t.columns.findIndex((c) => c.key === key);
check("TUTAR sayı (2 hane) — 1234567.89 Excel'de sayı", t.rows[2]![col("amount")] === 1234567.89 && JSON.stringify(t.columns[col("amount")]!.kind) === '{"t":"num","dec":2}');
check("SIRA tam sayı (1..5)", JSON.stringify(t.rows.map((r) => r[col("no")])) === "[1,2,3,4,5]");
check("boş seri no / banka / keşide '—' (PDF'teki gibi)", t.rows[1]![col("serialNo")] === "—" && t.rows[1]![col("bank")] === "—" && t.rows[2]![col("issueDate")] === "—");
check("tek para biriminde toplam satırı tutarı taşır", t.foot?.[col("amount")] === 1250581.24, `${t.foot?.[col("amount")]}`);
const kar = cekBordroKombinasyonlari().find((k) => k.ad === "karisik/bos/yok")!;
const kt = renderChequeDeliveryNoteTables(kar.snapshot, {});
check("karışık para biriminde toplam hücresi BOŞ, kırılım dipnotta", kt.tables[0]!.foot?.[col("amount")] === null && kt.notes.filter((n) => /^[A-Z]{3} \(/.test(n)).length === 3);
const tas = renderChequeDeliveryNoteTables(tek.snapshot, { draft: true });
check("taslakta Excel başlığı TASLAK ile başlar", tas.header[0]?.[0] === "TASLAK" && tas.header[0]?.[1] === null);
const sira = cekBordroKombinasyonlari().find((k) => k.ad === "tekPara/siraBaslik/yok")!;
const st = renderChequeDeliveryNoteTables(sira.snapshot, {}).tables[0]!;
check("şablon sırası + başlık + boş başlık Excel'e uygulanır", st.columns.slice(0, 3).map((c) => c.label).join("|") === "TUTAR & TL||ÇEK <#>", st.columns.map((c) => c.label).join("|"));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
