// =============================================================================
// Bekçi: BELGEDE TİCARİ YUVARLAMA — DB gerekmez
// Çalıştır: npx tsx scripts/test_belge_ticari_yuvarlama.ts
// =============================================================================
// Kullanıcı kararı (2026-09-26): belgelerde yarım değer YUKARI yuvarlanır, PDF ile Excel
// birlikte. `toFixed` ikili kayan noktada 112,35'i "112,3" basıyordu (x,y5 değerlerinin
// %40'ı, x,yz5'in %48'i). Tek biçimleyici `document-render/fmt-num.ts`.
//
// Donmuş belge JSON tutar ve her baskıda yeniden çizilir; yeniden baskı aslının aynısı
// kalsın diye yuvarlama rejimi zarfta DAMGALANIR — damgasız belge eski yuvarlamayla basılır.
//
// §1 yardımcının sınır değerleri · §2 fason çeki biçimi · §3 damganın tek okuyucusu ·
// §4 her renderer iki rejimde (beklenen metin bağımsız biçimleyiciyle: ticari = ICU
// halfExpand, eski = `toFixed`) · §5 belge yolunda çıplak `toFixed` yok (AST, muafiyet iki
// yönlü) · §6 damgayı tek yer yazar, tek yer okur (AST).
// "Güncel şablonla bas" yolu DB ister: `test_belge_yuvarlama_damgasi.ts`.
//
// Gerekli mi: doğduğu gün tabanda (`6591101d`) belge dizininde 17 `toFixed` vardı — 8'i
// görünen sayı (sevk · doğrudan sevk · kartela · iade · depo · kalite · fason çeki ·
// mutabakat), 9'u CSS ölçüsü; düzeltme aynı commit'te.
// Sonda (✓B3, bu commit; md5 ile geri alındı): ① `kartela-ceki.html.ts`e çıplak `toFixed`
// → §5 1 ❌, ihlal kaldırılınca 49/0 (pozitif) · ② `docNum` başka damga adı okur → 14 ❌
// (§2 · §3 · §4 · §6) · ③ `cssFixed` `toFixed`siz → §5 ölü muafiyet 1 ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { SAMPLE_PRINTED_DOCS, setSampleClock } from "../src/services/document-render/sample-data";
import { docNum, fmtTrNum, roundHalfUpParts, NUMBER_ROUNDING_HALF_UP } from "../src/services/document-render/fmt-num";
import { renderKartelaCekiHtml } from "../src/services/document-render/kartela-ceki.html";
import { renderReturnDispatchHtml } from "../src/services/document-render/return-dispatch.html";
import { renderQualityCertificateHtml } from "../src/services/document-render/quality-certificate.html";
import {
  renderGoodsReceiptHtml,
  renderStockCountHtml,
  renderWarehouseTransferHtml,
} from "../src/services/document-render/warehouse-doc.html";
import { renderFasonCekiHtml } from "../src/services/document-render/fason-ceki.html";
import { renderReconciliationLetterHtml } from "../src/services/document-render/finance-doc.html";
import { renderShipmentDispatchHtml, renderShipmentDispatchTables } from "../src/services/document-render/shipment-dispatch.html";
import { renderFasonDirectShipHtml, renderFasonDirectShipTables } from "../src/services/document-render/fason-direct-ship.html";

setSampleClock(() => new Date("2026-09-25T08:30:00.000Z"));

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const ROOT = join(__dirname, "..");
const DAMGALI = { numberRounding: NUMBER_ROUNDING_HALF_UP };

console.log("§1 Yardımcı — yarım-yukarı, sıfırdan uzağa, TR biçimi");
const SINIR: Array<[number | null | undefined, number, string]> = [
  [112.35, 1, "112,4"],
  [-112.35, 1, "-112,4"],
  [1.005, 2, "1,01"],
  [0.005, 2, "0,01"],
  [-0.005, 2, "-0,01"],
  [0.0049, 2, "0,00"],
  [-0.004, 2, "0,00"],
  [2.675, 2, "2,68"],
  [1.45, 1, "1,5"],
  [0.045, 2, "0,05"],
  [999.95, 1, "1.000,0"],
  [-999.95, 1, "-1.000,0"],
  [1234567.895, 2, "1.234.567,90"],
  [0.5, 0, "1"],
  [-0.5, 0, "-1"],
  [2.5, 0, "3"],
  [1000, 0, "1.000"],
  [12, 2, "12,00"],
  [5e-7, 6, "0,000001"],
  [1e21, 0, "1.000.000.000.000.000.000.000"],
  [null, 2, ""],
  [undefined, 1, ""],
  [Number.NaN, 1, ""],
  [Number.POSITIVE_INFINITY, 1, ""],
];
for (const [n, dec, beklenen] of SINIR) {
  const got = fmtTrNum(n, dec);
  check(`${String(n)} → ${dec} hane "${beklenen}"`, got === beklenen, got === beklenen ? "" : `"${got}"`);
}
// 3 haneli veri ızgarası (Decimal(12,3)) — tam sayı aritmetiğiyle beklenen, 0…1.000 m.
{
  let yanlis = 0;
  for (let k = 0; k <= 1_000_000; k++) {
    const p = roundHalfUpParts(k / 1000, 1);
    if (Number(p.int) * 10 + Number(p.frac) !== Math.floor((k + 50) / 100)) yanlis++;
  }
  check("3 haneli ızgara 0…1.000 (1.000.001 değer), 1 haneye: yanlış 0", yanlis === 0, `${yanlis}`);
}

console.log("§2 Fason çeki biçimi (1 hane, nokta ondalık, tam sayıda kesirsiz)");
const ticari = docNum(DAMGALI);
const eski = docNum({});
check("ticari: 112,35 → '112.4' · 115 → '115' · 0 → '' · null → ''",
  ticari.metreDot(112.35) === "112.4" && ticari.metreDot(115) === "115" && ticari.metreDot(0) === "" && ticari.metreDot(null) === "");
check("ticari negatif sıfırdan uzağa: -1,25 → '-1.3'", ticari.metreDot(-1.25) === "-1.3", ticari.metreDot(-1.25));
check("eski dal korunur (damgasız belge): -1,25 → '-1.2' (Math.round +∞'a yuvarlar)", eski.metreDot(-1.25) === "-1.2", eski.metreDot(-1.25));

console.log("§3 Damganın tek okuyucusu `docNum`");
check("damgasız zarf → eski yuvarlama (112,35 → '112,3')", eski.tr(112.35, 1) === "112,3");
check("damgalı zarf → ticari (112,35 → '112,4')", ticari.tr(112.35, 1) === "112,4");
check("tanınmayan damga → eski yuvarlama (bilinmeyen rejim yeni kurala yükseltilmez)", docNum({ numberRounding: "HALF_EVEN" }).tr(112.35, 1) === "112,3");

console.log("§4 ⭐ Her renderer iki rejimde — damgasız aslı gibi, damgalı ticari");
/** Bağımsız beklenen: ticari = ICU halfExpand (fmt-num'dan ayrı gerçekleme), eski = `toFixed`. */
function beklenenTr(n: number, dec: number, ticariMi: boolean): string {
  const abs = ticariMi
    ? Math.abs(n).toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: dec, maximumFractionDigits: dec })
    : Math.abs(n).toFixed(dec);
  const [i, f] = abs.split(".");
  return (n < 0 ? "-" : "") + i!.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (f ? `,${f}` : "");
}
/** Anahtarı eşleşen her sayı (ve ondalık dize) `yeni` ile değişir. */
function yamala(v: unknown, anahtar: RegExp, yeni: number, k = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => yamala(x, anahtar, yeni));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, yamala(x, anahtar, yeni, kk)]));
  }
  if (anahtar.test(k) && (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)))) {
    return typeof v === "string" ? String(yeni) : yeni;
  }
  return v;
}
const zarf = (doc: unknown, damga: object): PrintedDocSnapshot =>
  ({
    schemaVersion: 1,
    frozenAt: "2026-09-25T08:30:00.000Z",
    company: { name: "Deneme", letterhead: {}, logoHash: null },
    docConfigOverride: null,
    doc,
    ...damga,
  }) as unknown as PrintedDocSnapshot;

type Html = (s: PrintedDocSnapshot, m: Record<string, unknown>) => string;
const MIKTAR = /^(dispatchedQty|dispatchedWeight|qty|meters|totalMeters|totalQty|totalWeight|expectedQty|countedQty|expectedKg|countedKg|diffKg|expectedMeters|missingMeters|yarnDiffKg)$/;
const VAKALAR: Array<{ ad: string; tip: keyof typeof SAMPLE_PRINTED_DOCS; html: Html; deger: number; dec: number; anahtar?: RegExp; nokta?: boolean }> = [
  { ad: "kartela çeki (1 hane)", tip: "KARTELA_DISPATCH", html: renderKartelaCekiHtml as Html, deger: 112.35, dec: 1 },
  { ad: "iade irsaliyesi (2 hane)", tip: "RETURN_DISPATCH", html: renderReturnDispatchHtml as Html, deger: 112.345, dec: 2 },
  { ad: "kalite sertifikası (2 hane)", tip: "QUALITY_CERTIFICATE", html: renderQualityCertificateHtml as Html, deger: 112.345, dec: 2 },
  { ad: "depo transferi (2 hane)", tip: "TRANSFER_DISPATCH", html: renderWarehouseTransferHtml as Html, deger: 112.345, dec: 2 },
  { ad: "mal kabul (2 hane)", tip: "GOODS_RECEIPT", html: renderGoodsReceiptHtml as Html, deger: 112.345, dec: 2 },
  { ad: "stok sayımı (2 hane, negatif fark)", tip: "STOCK_COUNT", html: renderStockCountHtml as Html, deger: -112.345, dec: 2 },
  { ad: "sevk irsaliyesi (2 hane)", tip: "SHIPMENT_DISPATCH", html: renderShipmentDispatchHtml as Html, deger: 112.345, dec: 2 },
  { ad: "fasondan doğrudan sevk (1 hane)", tip: "SUBCONTRACTOR_DIRECT_SHIP", html: renderFasonDirectShipHtml as Html, deger: 112.35, dec: 1 },
  { ad: "mutabakat mektubu bakiyesi (2 hane)", tip: "RECONCILIATION_LETTER", html: renderReconciliationLetterHtml as Html, deger: 112.345, dec: 2, anahtar: /^balance$/ },
];
for (const v of VAKALAR) {
  const doc = yamala(JSON.parse(JSON.stringify(SAMPLE_PRINTED_DOCS[v.tip])), v.anahtar ?? MIKTAR, v.deger);
  const e = beklenenTr(v.deger, v.dec, false);
  const t = beklenenTr(v.deger, v.dec, true);
  const bakiye = v.anahtar ? (s: string) => s.replace(/^-/, "") : (s: string) => s;
  const eHtml = v.html(zarf(doc, {}), {});
  const tHtml = v.html(zarf(doc, DAMGALI), {});
  check(`${v.ad}: ${v.deger} damgasız '${bakiye(e)}', damgalı '${bakiye(t)}'`,
    e !== t && eHtml.includes(`>${bakiye(e)}<`) && !eHtml.includes(`>${bakiye(t)}<`) && tHtml.includes(`>${bakiye(t)}<`) && !tHtml.includes(`>${bakiye(e)}<`));
}
{
  // Fason çeki pozitifte iki rejimde aynı basar (Math.round(n·10) 3 haneli veride doğru); rejimi damga seçer.
  const doc = yamala(JSON.parse(JSON.stringify(SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DISPATCH)), MIKTAR, 112.35);
  const eHtml = renderFasonCekiHtml(zarf(doc, {}), {});
  const tHtml = renderFasonCekiHtml(zarf(doc, DAMGALI), {});
  check("fason sevk çeki: 112,35 iki rejimde '112.4'", eHtml.includes(">112.4<") && tHtml.includes(">112.4<"));
}
{
  // PDF = Excel: Excel değeri kâğıttaki haneyi taşır — iki rejimde.
  const sevk = yamala(JSON.parse(JSON.stringify(SAMPLE_PRINTED_DOCS.SHIPMENT_DISPATCH)), MIKTAR, 112.345);
  const dog = yamala(JSON.parse(JSON.stringify(SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DIRECT_SHIP)), MIKTAR, 112.35);
  const hucreler = (p: { tables: Array<{ rows: unknown[][] }> }) => p.tables.flatMap((t) => t.rows.flat());
  check("sevk irsaliyesi Excel: damgasız 112.34, damgalı 112.35",
    hucreler(renderShipmentDispatchTables(zarf(sevk, {}), {})).includes(112.34) && hucreler(renderShipmentDispatchTables(zarf(sevk, DAMGALI), {})).includes(112.35));
  check("doğrudan sevk Excel: damgasız 112.3, damgalı 112.4",
    hucreler(renderFasonDirectShipTables(zarf(dog, {}), {})).includes(112.3) && hucreler(renderFasonDirectShipTables(zarf(dog, DAMGALI), {})).includes(112.4));
}

// ── AST ─────────────────────────────────────────────────────────────────────
const BELGE_DIZINI = join(ROOT, "src/services/document-render");
const FMT_NUM = "src/services/document-render/fmt-num.ts";
/** Beyanlı muafiyet: `toFixed` yalnız eski dalda (damgasız belge) ve CSS ölçüsünde. */
const TOFIXED_MUAF = new Set([`${FMT_NUM}#LEGACY_NUM`, `${FMT_NUM}#cssFixed`]);

function kaynak(abs: string): ts.SourceFile {
  return ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
}
/** Düğümü saran en dıştaki modül düzeyi bildirimin adı (fonksiyon ya da değişken). */
function sahibi(n: ts.Node): string {
  let cur: ts.Node = n;
  while (cur.parent && !ts.isSourceFile(cur.parent)) cur = cur.parent;
  if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
  if (ts.isVariableStatement(cur)) {
    const d = cur.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name)) return d.name.text;
  }
  return "(modül)";
}
function ziyaret(sf: ts.SourceFile, fn: (n: ts.Node) => void): void {
  const git = (n: ts.Node): void => {
    fn(n);
    ts.forEachChild(n, git);
  };
  git(sf);
}

console.log("§5 ⭐ Belge yolunda çıplak `toFixed` yok (görünen sayı `docNum`dan, CSS ölçüsü `cssFixed`ten)");
{
  const dosyalar = walkTs(BELGE_DIZINI);
  const ihlal: string[] = [];
  const muafSayac = new Map<string, number>();
  for (const abs of dosyalar) {
    const rel = relative(ROOT, abs);
    ziyaret(kaynak(abs), (n) => {
      if (!ts.isCallExpression(n)) return;
      const e = n.expression;
      const ad = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression) ? e.argumentExpression.text : null;
      if (ad !== "toFixed") return;
      const anahtar = `${rel}#${sahibi(n)}`;
      if (TOFIXED_MUAF.has(anahtar)) muafSayac.set(anahtar, (muafSayac.get(anahtar) ?? 0) + 1);
      else ihlal.push(`${rel}:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1} (${sahibi(n)})`);
    });
  }
  check("körlük zemini: belge dizininde ≥ 25 dosya tarandı", dosyalar.length >= 25, `${dosyalar.length}`);
  check("belge yolunda muafiyet dışı `toFixed` yok", ihlal.length === 0, ihlal.join(" · "));
  for (const m of TOFIXED_MUAF) check(`muafiyet canlı (ölü muafiyet yok): ${m}`, (muafSayac.get(m) ?? 0) > 0, `${muafSayac.get(m) ?? 0} çağrı`);
}

console.log("§6 ⭐ Yuvarlama damgası: TEK yazar (zarf kurucusu), TEK okur (`docNum`)");
{
  const yazan: string[] = [];
  const okuyan: string[] = [];
  for (const abs of walkTs(join(ROOT, "src"))) {
    const rel = relative(ROOT, abs);
    ziyaret(kaynak(abs), (n) => {
      const yer = `${rel}#${sahibi(n)}`;
      if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && ts.isIdentifier(n.name) && n.name.text === "numberRounding") yazan.push(yer);
      if (ts.isPropertyAccessExpression(n) && n.name.text === "numberRounding") okuyan.push(yer);
      if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "numberRounding") okuyan.push(yer);
    });
  }
  check("tek yazar: printed-document.service#envelopeHead", yazan.length === 1 && yazan[0] === "src/services/printed-document.service.ts#envelopeHead", yazan.join(" · "));
  check("tek okur: fmt-num#docNum", okuyan.length === 1 && okuyan[0] === `${FMT_NUM}#docNum`, okuyan.join(" · "));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
