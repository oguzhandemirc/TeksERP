// =============================================================================
// Bekçi: SEVK İRSALİYESİNİN PDF'İ İLE EXCEL'İ AYNI KOLONU, SATIRI, DEĞERİ TAŞIR — DB gerekmez
// Çalıştır: npx tsx scripts/test_sevk_belge_excel_esit.ts
// =============================================================================
// Saha şikâyeti (2026-09-25, fabrikadan telefon): "Sevk irsaliyesinde PDF ve Excel
// birebir aynı çıktıyı vermeli; çeki ve çuval listesinde ambalaj no ve parti yok."
// Kök neden: PDF backend'de şablon + bayraklarla çiziliyordu, Excel panelde elle
// kurulmuş SABİT bir kolon listesinden. Kural (kullanıcı): aynı belgenin PDF'i ve
// Excel'i aynı kolon/değer çözücüsünden türer.
//
// Ölçüm: fikstürün (`lib/sevk-belge-fikstur.ts`) her kombinasyonunda
// `renderShipmentDispatchHtml` çıktısındaki tablolar ayrıştırılır ve
// `renderShipmentDispatchTables` modeliyle karşılaştırılır — tablo sayısı + başlık,
// kolon başlıkları (sıra dahil), satır sayısı, HER HÜCRE, toplam satırı. Excel
// değeri, PDF'in metnine BAĞIMSIZ bir biçimleyiciyle çevrilir (modelin kendi
// `docCellHtml`i kullanılmaz; o, ölçülen şeyin parçasıdır).
//
// Negatif sonda (commit mesajında, ✓B2): ① renderer'da çuval tablosuna YALNIZ
// HTML'e bir kolon eklendi → kırmızı · ② modelden (Excel) çeki tablosunun bir
// kolonu düşürüldü → kırmızı; ikisi de md5 ile geri alındı.
// =============================================================================
import {
  renderShipmentDispatchHtml,
  renderShipmentDispatchTables,
} from "../src/services/document-render/shipment-dispatch.html";
import type { DocCellKind, DocCellValue } from "../src/services/document-render/doc-model";
import { normalizeHtml, sevkBelgeKombinasyonlari } from "./lib/sevk-belge-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

/** HTML kaçışı — renderer'ınkinden bağımsız yazıldı (aynı dört karakter). */
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

interface HtmlTable {
  caption: string;
  headers: string[];
  rows: string[][];
  foot: string[] | null;
}

/** Normalize edilmiş HTML'den `.sec` tablolarını çıkarır. */
function parseTables(html: string): HtmlTable[] {
  const out: HtmlTable[] = [];
  for (const m of html.matchAll(/<table class="sec[^"]*">([\s\S]*?)<\/table>/g)) {
    const body = m[1]!;
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(body)?.[1] ?? "";
    const caption = /<th class="caption"[^>]*>([\s\S]*?)<\/th>/.exec(thead)?.[1] ?? "";
    const headRows = [...thead.matchAll(/<tr( class="ident")?>([\s\S]*?)<\/tr>/g)].filter((r) => !r[1]);
    const lastHead = headRows[headRows.length - 1]?.[2] ?? "";
    const headers = lastHead.includes('class="caption"')
      ? []
      : [...lastHead.matchAll(/<th class="[lrc]"[^>]*>([\s\S]*?)<\/th>/g)].map((x) => x[1]!);
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

const kombinasyonlar = sevkBelgeKombinasyonlari();
let tablo = 0;
let hucre = 0;
const gorulenBaslik = new Set<string>();
const hatalar: string[] = [];

for (const k of kombinasyonlar) {
  const html = normalizeHtml(renderShipmentDispatchHtml(k.snapshot, k.meta));
  const htmlTables = parseTables(html);
  const model = renderShipmentDispatchTables(k.snapshot, k.meta);
  // Bütün kolonları gizlenmiş tablo HTML'de hiç çizilmez; modelde kolonsuz durur.
  const modelTables = model.tables.filter((t) => t.columns.length > 0);
  if (htmlTables.length !== modelTables.length) {
    hatalar.push(`${k.ad}: tablo sayısı HTML ${htmlTables.length} ≠ Excel ${modelTables.length}`);
    continue;
  }
  modelTables.forEach((mt, ti) => {
    const ht = htmlTables[ti]!;
    tablo++;
    const yer = `${k.ad} [${mt.caption}]`;
    if (ht.caption !== esc(mt.caption)) hatalar.push(`${yer}: başlık ${ht.caption} ≠ ${mt.caption}`);
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
      row.forEach((v, ci) => {
        hucre++;
        const beklenen = asPdfText(mt.columns[ci]!.kind, v);
        const pdf = ht.rows[ri]![ci];
        if (pdf !== beklenen) hatalar.push(`${yer} satır ${ri + 1} "${mt.columns[ci]!.label}": PDF "${pdf}" ≠ Excel "${beklenen}"`);
      });
    });
    const htmlFoot = ht.foot?.join("|") ?? null;
    const modelFoot = mt.foot ? mt.foot.map((v, ci) => asPdfText(mt.columns[ci]!.kind, v)).join("|") : null;
    if (htmlFoot !== modelFoot) hatalar.push(`${yer}: toplam PDF ${htmlFoot} ≠ Excel ${modelFoot}`);
  });
}

console.log("§1 Körlük zemini");
check("kombinasyon ≥ 300", kombinasyonlar.length >= 300, `${kombinasyonlar.length}`);
check("karşılaştırılan tablo ≥ 700", tablo >= 700, `${tablo}`);
check("karşılaştırılan hücre ≥ 10.000", hucre >= 10_000, `${hucre}`);
// Saha şikâyetinin kolonları uzayda GERÇEKTEN görünüyor mu (görünmüyorsa eşitlik boştur).
for (const b of ["AMBALAJ NO", "SEVK PARTİSİ", "PARTİ KODU", "PARTİ NO", "SIRA", "EN", "PKG #", "LOT", "AÇIKLAMA", "İZ", "MÜŞTERİ VARYANT"]) {
  check(`uzayda "${b}" kolonu ölçüldü`, gorulenBaslik.has(b));
}

console.log("§2 ⭐ Her kombinasyonda PDF tabloları = Excel tabloları (kolon · sıra · başlık · satır · hücre · toplam)");
check(`${kombinasyonlar.length} kombinasyonda fark yok`, hatalar.length === 0, hatalar.length ? `${hatalar.length} fark:\n      ${hatalar.slice(0, 10).join("\n      ")}` : "");

console.log("§3 ⭐ Saha vakası — ambalaj no + sevk partisi + parti no Excel'de");
const saha = kombinasyonlar.find((k) => k.ad === "zengin/bos/packingLot")!;
const sahaModel = renderShipmentDispatchTables(saha.snapshot, saha.meta);
const cuval = sahaModel.tables.find((t) => t.key === "cuval")!;
const ceki = sahaModel.tables.find((t) => t.key === "ceki")!;
const kol = (t: typeof cuval, label: string) => t.columns.findIndex((c) => c.label === label);
check("çuval listesinde AMBALAJ NO + SEVK PARTİSİ", kol(cuval, "AMBALAJ NO") >= 0 && kol(cuval, "SEVK PARTİSİ") >= 0);
check("çeki listesinde AMBALAJ NO + SEVK PARTİSİ + PARTİ NO", kol(ceki, "AMBALAJ NO") >= 0 && kol(ceki, "SEVK PARTİSİ") >= 0 && kol(ceki, "PARTİ NO") >= 0);
check("ambalaj no SAYI olarak gider (1, 2, boş)", JSON.stringify(cuval.rows.map((r) => r[kol(cuval, "AMBALAJ NO")])) === "[1,2,null]");
check("parti no top başına ('—' eski/eksik partide)", JSON.stringify(ceki.rows.map((r) => r[kol(ceki, "PARTİ NO")])) === '["P0925001","—","P0925002","P0925003"]');
check("kg=0 satırı Excel'de BOŞ (0,00 değil)", ceki.rows[2]![kol(ceki, "KG")] === null);
check("metre 2 ondalık türünde", JSON.stringify(ceki.columns[kol(ceki, "METRE")]!.kind) === '{"t":"num","dec":2}');
const optIn = renderShipmentDispatchTables(kombinasyonlar.find((k) => k.ad === "zengin/yalnizOptIn/yok")!.snapshot, {});
check("opt-in PARTİ KODU şablonda açıksa Excel'de de var", optIn.tables.filter((t) => t.columns.some((c) => c.label === "PARTİ KODU")).length === 2);
check("opt-in kapalıyken PARTİ KODU Excel'e SIZMAZ", !sahaModel.tables.some((t) => t.columns.some((c) => c.label === "PARTİ KODU")));

console.log("§4 Belge başlığı ve dil");
const hdr = new Map(sahaModel.header.filter(([, v]) => v != null) as Array<[string, string]>);
check("başlıkta irsaliye no · tarih · müşteri · V.No · yön · araç", hdr.get("İrsaliye No") === "SVK-2609-0007" && hdr.has("Tarih") && hdr.get("SAYIN") === "Örnek Konfeksiyon <Ltd>" && hdr.get("V.No") === "9876543210" && hdr.get("Yön") === "Yurtdışı" && hdr.get("Plaka") === "35 ZZ 350");
const en = renderShipmentDispatchTables(kombinasyonlar.find((k) => k.ad === "zengin/otoDil/packingLot")!.snapshot, { packingLot: true });
check("ihracatta (auto) Excel başlıkları İngilizce", en.tables.map((t) => t.caption).join("|") === "PRODUCT LIST|PACKAGE LIST|PACKING LIST" && en.header.some(([l]) => l === "Delivery Note No"));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
