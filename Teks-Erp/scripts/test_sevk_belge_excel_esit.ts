// =============================================================================
// Bekçi: SEVK BELGELERİNİN PDF'İ İLE EXCEL'İ AYNI KOLONU, SATIRI, DEĞERİ TAŞIR — DB gerekmez
// Çalıştır: npx tsx scripts/test_sevk_belge_excel_esit.ts
// =============================================================================
// Saha şikâyeti (2026-09-25, fabrikadan telefon): "Sevk irsaliyesinde PDF ve Excel
// birebir aynı çıktıyı vermeli; çeki ve çuval listesinde ambalaj no ve parti yok."
// Kök neden: PDF backend'de şablon + bayraklarla çiziliyordu, Excel panelde elle
// kurulmuş SABİT bir kolon listesinden. Kural (kullanıcı): aynı belgenin PDF'i ve
// Excel'i aynı kolon/değer çözücüsünden türer.
//
// Ölçüm: fikstürün (`lib/sevk-belge-fikstur.ts`) her kombinasyonunda sevk
// irsaliyesinin ve fasondan doğrudan sevk irsaliyesinin HTML tabloları ayrıştırılır
// ve aynı belgenin `render…Tables` modeliyle karşılaştırılır — tablo sayısı + başlık,
// kolon başlıkları (sıra dahil), satır sayısı, HER HÜCRE, toplam satırı. Excel
// değeri, PDF'in metnine BAĞIMSIZ bir biçimleyiciyle çevrilir (modelin kendi
// `docCellHtml`i kullanılmaz; o, ölçülen şeyin parçasıdır). Uzay iki yuvarlama
// rejimini de taşır: damgasız (eski) zarf `toFixed`le, `numberRounding` damgalı zarf
// ticari yuvarlamayla basılır — bağımsız biçimleyici damgaya göre ikisinden birini seçer.
//
// Negatif sonda (commit mesajında, ✓B2): ① renderer'da çuval tablosuna YALNIZ
// HTML'e bir kolon eklendi → kırmızı · ② modelden (Excel) çeki tablosunun bir
// kolonu düşürüldü → kırmızı; ikisi de md5 ile geri alındı.
// =============================================================================
import {
  renderShipmentDispatchHtml,
  renderShipmentDispatchTables,
} from "../src/services/document-render/shipment-dispatch.html";
import {
  renderFasonDirectShipHtml,
  renderFasonDirectShipTables,
} from "../src/services/document-render/fason-direct-ship.html";
import type { DocCellKind, DocCellValue, DocTablesPayload } from "../src/services/document-render/doc-model";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import {
  dogrudanKombinasyonlari,
  normalizeHtml,
  sevkBelgeKombinasyonlari,
  type SevkBelgeKombinasyon,
} from "./lib/sevk-belge-fikstur";

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

/**
 * TR sayı biçimi — renderer'dan bağımsız: binlik ".", ondalık ",". Ticari rejimde
 * yuvarlamayı ICU yapar (halfExpand, `fmt-num.ts`ten ayrı bir gerçekleme); eski
 * rejimde damgasız belgenin `toFixed`i.
 */
function trNum(n: number, dec: number, ticari: boolean): string {
  const abs = ticari
    ? Math.abs(n).toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: dec, maximumFractionDigits: dec })
    : Math.abs(n).toFixed(dec);
  const [int, frac] = abs.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const neg = n < 0 && (!ticari || /[1-9]/.test(abs));
  return (neg ? "-" : "") + grouped + (frac ? `,${frac}` : "");
}

/** Excel hücresi PDF'te nasıl okunur — değer + tür (+ yuvarlama rejimi) → görünen metin. */
function asPdfText(kind: DocCellKind, v: DocCellValue, ticari = false): string {
  if (v == null) return "";
  if (typeof v === "string") return esc(v);
  if (kind.t === "text") return esc(String(v));
  const body = kind.t === "int" ? String(v) : trNum(v, kind.dec, ticari);
  return body + (kind.suffix ?? "");
}

/** Zarf ticari yuvarlama damgası taşıyor mu — fikstürün `/ticari` kombinasyonları. */
const ticariMi = (s: PrintedDocSnapshot): boolean => (s as { numberRounding?: unknown }).numberRounding === "HALF_UP";

interface HtmlTable {
  caption: string;
  headers: string[];
  rows: string[][];
  foot: string[] | null;
}

/** Normalize edilmiş HTML'den `.sec` tablolarını çıkarır — başlık tablo içinde
 *  (`th.caption`, sevk irsaliyesi) ya da hemen önündeki `div.tbl-cap`ta (doğrudan sevk). */
function parseTables(html: string): HtmlTable[] {
  const out: HtmlTable[] = [];
  for (const m of html.matchAll(/(?:<div class="tbl-cap">([^<]*)<\/div>\s*)?<table class="sec[^"]*">([\s\S]*?)<\/table>/g)) {
    const body = m[2]!;
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(body)?.[1] ?? "";
    const caption = /<th class="caption"[^>]*>([\s\S]*?)<\/th>/.exec(thead)?.[1] ?? m[1] ?? "";
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

type Render = (s: PrintedDocSnapshot, m: Record<string, unknown>) => string;
type Tables = (s: PrintedDocSnapshot, m: Record<string, unknown>) => DocTablesPayload;

const kombinasyonlar = sevkBelgeKombinasyonlari();
const dogrudan = dogrudanKombinasyonlari();
let tablo = 0;
let hucre = 0;
const sayac = { sevk: 0, dogrudan: 0 };
const gorulenBaslik = new Set<string>();
const hatalar: string[] = [];

const uzay: Array<[keyof typeof sayac, SevkBelgeKombinasyon[], Render, Tables]> = [
  ["sevk", kombinasyonlar, renderShipmentDispatchHtml as Render, renderShipmentDispatchTables as Tables],
  ["dogrudan", dogrudan, renderFasonDirectShipHtml as Render, renderFasonDirectShipTables as Tables],
];
const rejimSayac = { eski: 0, ticari: 0 };
for (const [tur, liste, renderHtml, renderTables] of uzay)
for (const k of liste) {
  const ticari = ticariMi(k.snapshot);
  rejimSayac[ticari ? "ticari" : "eski"]++;
  const html = normalizeHtml(renderHtml(k.snapshot, k.meta));
  const htmlTables = parseTables(html);
  const model = renderTables(k.snapshot, k.meta);
  // Bütün kolonları gizlenmiş tablo HTML'de hiç çizilmez; modelde kolonsuz durur.
  const modelTables = model.tables.filter((t) => t.columns.length > 0);
  if (htmlTables.length !== modelTables.length) {
    hatalar.push(`${k.ad}: tablo sayısı HTML ${htmlTables.length} ≠ Excel ${modelTables.length}`);
    continue;
  }
  modelTables.forEach((mt, ti) => {
    const ht = htmlTables[ti]!;
    tablo++;
    sayac[tur]++;
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
        const beklenen = asPdfText(mt.columns[ci]!.kind, v, ticari);
        const pdf = ht.rows[ri]![ci];
        if (pdf !== beklenen) hatalar.push(`${yer} satır ${ri + 1} "${mt.columns[ci]!.label}": PDF "${pdf}" ≠ Excel "${beklenen}"`);
      });
    });
    const htmlFoot = ht.foot?.join("|") ?? null;
    const modelFoot = mt.foot ? mt.foot.map((v, ci) => asPdfText(mt.footKinds?.[ci] ?? mt.columns[ci]!.kind, v, ticari)).join("|") : null;
    if (htmlFoot !== modelFoot) hatalar.push(`${yer}: toplam PDF ${htmlFoot} ≠ Excel ${modelFoot}`);
  });
}

console.log("§1 Körlük zemini");
check("sevk irsaliyesi kombinasyonu ≥ 300", kombinasyonlar.length >= 300, `${kombinasyonlar.length}`);
check("doğrudan sevk kombinasyonu ≥ 80", dogrudan.length >= 80, `${dogrudan.length}`);
check("karşılaştırılan tablo ≥ 700", tablo >= 700, `${tablo}`);
check("doğrudan sevk tablosu ≥ 100", sayac.dogrudan >= 100, `${sayac.dogrudan}`);
check("karşılaştırılan hücre ≥ 10.000", hucre >= 10_000, `${hucre}`);
check("iki yuvarlama rejimi de uzayda (eski ≥ 400 · ticari ≥ 400)", rejimSayac.eski >= 400 && rejimSayac.ticari >= 400, JSON.stringify(rejimSayac));
// Saha şikâyetinin kolonları uzayda GERÇEKTEN görünüyor mu (görünmüyorsa eşitlik boştur).
for (const b of ["AMBALAJ NO", "SEVK PARTİSİ", "PARTİ KODU", "PARTİ NO", "SIRA", "EN", "PKG #", "LOT", "AÇIKLAMA", "İZ", "MÜŞTERİ VARYANT", "SİPARİŞ NO", "MİKTAR", "BARKOD", "ÜRÜN / RENK"]) {
  check(`uzayda "${b}" kolonu ölçüldü`, gorulenBaslik.has(b));
}

console.log("§2 ⭐ Her kombinasyonda PDF tabloları = Excel tabloları (kolon · sıra · başlık · satır · hücre · toplam)");
check(`${kombinasyonlar.length + dogrudan.length} kombinasyonda fark yok`, hatalar.length === 0, hatalar.length ? `${hatalar.length} fark:\n      ${hatalar.slice(0, 10).join("\n      ")}` : "");

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

console.log("§5 ⭐ Fasondan doğrudan sevk — Excel PDF'in iki tablosunu ve kutularını taşır");
const dz = renderFasonDirectShipTables(dogrudan.find((k) => k.ad === "dogrudan/zengin/yok/yok")!.snapshot, {});
check("iki tablo: Karşılanan Siparişler + Sevk Edilen Toplar", dz.tables.map((t) => t.caption).join("|") === "Karşılanan Siparişler (2)|Sevk Edilen Toplar (3)");
const toplar = dz.tables[1]!;
check("toplam satırı: metre 'm', kg 'kg' ekiyle (kolondan farklı tür)",
  JSON.stringify(toplar.footKinds?.slice(-2)) === '[{"t":"num","dec":1,"suffix":" m"},{"t":"num","dec":1,"suffix":" kg"}]' && toplar.foot?.slice(-2).join("|") === "1374.6|38.3");
check("kg'sız top '—', ensiz top '—' (PDF'teki gibi)", toplar.rows[1]!.slice(-3).join("|") === "—|100|—");
const dhdr = dz.header.map(([l, v]) => (v == null ? l : `${l}=${v}`));
check("başlık bloğu: irsaliye no · fason sevk no · parti · müşteri/fason/araç kutuları",
  ["İrsaliye No=SVK-2609-0101", "Fason Sevk No=FSN-2609-0042", "Parti No=P0925009", "MÜŞTERİ (Malın Gittiği)", "Adı=Örnek & Konfeksiyon", "FASON FİRMA (Malın Geldiği)", "ARAÇ / SEVKİYAT", "Not=Rampa 2 & kapı 3"].every((x) => dhdr.includes(x)), dhdr.join(" · "));
const deski = renderFasonDirectShipTables(dogrudan.find((k) => k.ad === "dogrudan/eski/yok/yok")!.snapshot, {});
check("eski snapshot: sipariş tablosu yok, toplam kg '—'", deski.tables.length === 1 && deski.tables[0]!.foot?.at(-1) === "—");

console.log("§6 ⭐ Excel sayısı PDF'te BASILAN haneyi taşır (yarım değerde tablo programının yuvarlamasına bırakılmaz)");
// Veri 3 ondalık (Decimal(12,3)). Damgasız (eski) belge `toFixed` ile basar ve ikili kayan
// noktada 112,35 → "112,3", 1,005 → "1,00" olur; aslı öyle basıldığı için yeniden baskı da
// öyle kalır. Damgalı belge ticari yuvarlar: "112,4" / "1,01". İki rejimde de Excel PDF'in
// bastığı haneyi taşır.
{
  const base = dogrudan.find((k) => k.ad === "dogrudan/zengin/yok/yok")!;
  const doc = base.snapshot.doc as { rolls: Array<Record<string, unknown>>; totals: Record<string, number> };
  const snap = { ...base.snapshot, doc: { ...doc, rolls: [{ ...doc.rolls[0], dispatchedQty: 112.35, dispatchedWeight: 1.25 }], totals: { rollCount: 1, totalQty: 112.35, totalWeight: 1.25 } } } as PrintedDocSnapshot;
  const t = renderFasonDirectShipTables(snap, {}).tables.find((x) => x.key === "rollTable")!;
  const pdf = parseTables(normalizeHtml(renderFasonDirectShipHtml(snap, {}))).find((x) => x.caption.startsWith("Sevk Edilen"))!;
  const mi = t.columns.findIndex((c) => c.key === "meters");
  check("doğrudan sevk 112,35 (1 hane): PDF '112,3' ve Excel değeri 112.3", pdf.rows[0]![mi] === "112,3" && t.rows[0]![mi] === 112.3, `${pdf.rows[0]![mi]} / ${t.rows[0]![mi]}`);
  check("toplam da aynı kuralla (112.3 'm')", t.foot?.[mi] === 112.3);
}
{
  const base = kombinasyonlar.find((k) => k.ad === "zengin/bos/yok")!;
  const doc = base.snapshot.doc as { cekiRows: Array<Record<string, unknown>> };
  const snap = { ...base.snapshot, doc: { ...doc, cekiRows: [{ ...doc.cekiRows[0], meters: 1.005, kg: 2.675 }] } } as PrintedDocSnapshot;
  const t = renderShipmentDispatchTables(snap, {}).tables.find((x) => x.key === "ceki")!;
  const pdf = parseTables(normalizeHtml(renderShipmentDispatchHtml(snap, {}))).find((x) => x.caption === "ÇEKİ LİSTESİ")!;
  const mi = t.columns.findIndex((c) => c.label === "METRE");
  const ki = t.columns.findIndex((c) => c.label === "KG");
  check("sevk irsaliyesi 1,005 / 2,675 (2 hane): Excel değeri PDF'in bastığı hane",
    pdf.rows[0]![mi] === asPdfText(t.columns[mi]!.kind, t.rows[0]![mi]!) && pdf.rows[0]![ki] === asPdfText(t.columns[ki]!.kind, t.rows[0]![ki]!) && t.rows[0]![mi] === Number((1.005).toFixed(2)),
    `PDF ${pdf.rows[0]![mi]} · ${pdf.rows[0]![ki]} / Excel ${t.rows[0]![mi]} · ${t.rows[0]![ki]}`);
}
{
  const base = dogrudan.find((k) => k.ad === "dogrudan/zengin/yok/yok/ticari")!;
  const doc = base.snapshot.doc as { rolls: Array<Record<string, unknown>>; totals: Record<string, number> };
  const snap = { ...base.snapshot, doc: { ...doc, rolls: [{ ...doc.rolls[0], dispatchedQty: 112.35, dispatchedWeight: 1.25 }], totals: { rollCount: 1, totalQty: 112.35, totalWeight: 1.25 } } } as PrintedDocSnapshot;
  const t = renderFasonDirectShipTables(snap, {}).tables.find((x) => x.key === "rollTable")!;
  const pdf = parseTables(normalizeHtml(renderFasonDirectShipHtml(snap, {}))).find((x) => x.caption.startsWith("Sevk Edilen"))!;
  const mi = t.columns.findIndex((c) => c.key === "meters");
  check("damgalı doğrudan sevk 112,35 (1 hane): PDF '112,4' ve Excel değeri 112.4", pdf.rows[0]![mi] === "112,4" && t.rows[0]![mi] === 112.4, `${pdf.rows[0]![mi]} / ${t.rows[0]![mi]}`);
  check("damgalı toplam da aynı kuralla (112.4 'm')", t.foot?.[mi] === 112.4);
}
{
  const base = kombinasyonlar.find((k) => k.ad === "zengin/bos/yok/ticari")!;
  const doc = base.snapshot.doc as { cekiRows: Array<Record<string, unknown>> };
  const snap = { ...base.snapshot, doc: { ...doc, cekiRows: [{ ...doc.cekiRows[0], meters: 1.005, kg: 2.675 }] } } as PrintedDocSnapshot;
  const t = renderShipmentDispatchTables(snap, {}).tables.find((x) => x.key === "ceki")!;
  const pdf = parseTables(normalizeHtml(renderShipmentDispatchHtml(snap, {}))).find((x) => x.caption === "ÇEKİ LİSTESİ")!;
  const mi = t.columns.findIndex((c) => c.label === "METRE");
  const ki = t.columns.findIndex((c) => c.label === "KG");
  check("damgalı sevk irsaliyesi 1,005 / 2,675: PDF '1,01' · '2,68', Excel 1.01 · 2.68",
    pdf.rows[0]![mi] === "1,01" && pdf.rows[0]![ki] === "2,68" && t.rows[0]![mi] === 1.01 && t.rows[0]![ki] === 2.68,
    `PDF ${pdf.rows[0]![mi]} · ${pdf.rows[0]![ki]} / Excel ${t.rows[0]![mi]} · ${t.rows[0]![ki]}`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
