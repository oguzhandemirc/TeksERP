// =============================================================================
// Bekçi: LEVENT KALANI — defter yazan her yol kalanı TEK kilitli okuyucudan alır (DB'siz, AST)
// Çalıştır: npx tsx scripts/test_levent_kalan_tek_okuyucu.ts
// =============================================================================
// NEDEN: kalan metre kolon değil, olaylardan türetilir. Kalanı kilitsiz okuyan bir yazar, eşzamanlı ikinci
// yazımla aynı eski kalanı görür ve kalan eksiye düşer (`TOKEN-REPLAY-KILIDI.md` §5-6; zorlanmış sırada
// ölçüldü 2026-09-26: iki 60 m tüketim, kalan 100 → −20). Çare TEK okuyucu: `remainingMTx` önce levent satırını
// `FOR UPDATE` kilitler, sonra okur. Bu bekçi kuralı YAPISAL ölçer (AST, fonksiyon birimi başına):
//   §1 levent defterine yazan her fonksiyon birimi (`applyWarpBeamEventTx` / `closeToMeasuredTx` çağıran)
//      kalanı yalnız `remainingMTx`ten okur — kalanı DOĞRUDAN ya da DOLAYLI okuyan hiçbir fonksiyonu (gösterim
//      okuyucusu, toplayıcı, işaret tablosu ve bunları çağıran her fonksiyon — ör. `freshBeamDto`; takma adlar
//      dahil, geçişli kapanış) yanıtın `data:` alanı dışında çağırmaz, olay tablosunu elle toplamaz.
//   §2 toplayıcı (`warpBeamRemainingM`) ve işaret tablosu (`warpBeamLengthSign`) yalnız beyanlı birimlerde.
//   §3 `remainingMTx` gövdesi TAM iki ifade: aynı tx ile `SELECT id FROM warp_beams WHERE id = $beamId::uuid FOR UPDATE`
//      (SKIP LOCKED / NOWAIT / başka istemci kırmızı), sonra `return readRemainingM(tx, beamId)`.
//   §4 körlük: yazar birimleri ve kalan okuyan yazarlar adıyla bulunur — ad değişirse tarama kör kalmaz, kızarır.
// Eşzamanlı sondası: `test_token_replay_zorlanmis_sira` ①e.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const LEDGER = "src/services/helpers/warp-beam-ledger.helper.ts";

const YAZARLAR = new Set(["applyWarpBeamEventTx", "closeToMeasuredTx"]);
const KILITLI_OKUYUCU = "remainingMTx";
/** Yazar biriminde yasak: kilitsiz gösterim okuyucuları + kalanı elle kurmanın iki parçası. */
const YAZARDA_YASAK = new Set(["readRemainingM", "remainingByBeam", "warpBeamRemainingM", "warpBeamLengthSign"]);

/** Toplayıcı/işaret tablosunu çağırabilen birimler (dosya::birim) — hepsi GÖSTERİM ya da okuyucunun kendisi. */
const TOPLAYICI_BEYANI = new Set([
  "src/services/helpers/warp-beam-ledger.helper.ts::readRemainingM",
  "src/services/helpers/warp-beam.helper.ts::warpBeamRemainingM",
  "src/services/helpers/warp-beam.helper.ts::remainingByBeam",
  "src/services/warp-beam.service.ts::getWarpBeam",
]);

/** Kalanı defter yazımına sokan yazarlar — ADIYLA (§4). Yeni yazar eklenirse buraya da girer. */
const KALAN_OKUYAN_YAZARLAR = new Set([
  "src/services/warp-beam-consume.service.ts::consumeBeam",
  "src/services/warp-beam-consume.service.ts::adjustBeam",
  "src/services/warp-beam-consume.service.ts::scrapBeam",
  "src/services/helpers/warp-beam-ledger.helper.ts::closeToMeasuredTx",
  "src/services/warp-beam-auto-consume.service.ts::autoConsumeForRollTx",
  "src/services/subcontractor-beam.service.ts::dispatchWarpBeamItemsTx",
  "src/services/warp-beam-mount.service.ts::mountBeamFresh",
]);

type Birim = { anahtar: string; ad: string; dugum: ts.Node; cagrilar: Array<{ ad: string; satir: number; yanit: boolean }>; elleToplama: number[] };
/** `const takma = asil` — dolaylı okuyucunun takma adı da okuyucudur. */
const takmaAdlar: Array<[string, string]> = [];

function birimAdi(n: ts.Node): string {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
  if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
  if (ts.isPropertyAssignment(n.parent)) return n.parent.name.getText();
  return `<anonim:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}>`;
}
/** Çağrı, birim içinde yanıt nesnesinin `data:` alanında mı (gösterim; karar değil). */
function yanitAlaninda(n: ts.Node, birim: ts.Node): boolean {
  for (let u: ts.Node | undefined = n.parent; u && u !== birim; u = u.parent) if (ts.isPropertyAssignment(u) && u.name.getText() === "data") return true;
  return false;
}
const fonksiyonMu = (n: ts.Node) => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

/** Her çağrı EN DIŞTAKİ fonksiyon birimine yazılır ($transaction geri çağrısı, sarmalayan servisin içindedir). */
function birimler(dosya: string): Birim[] {
  const rel = path.relative(ROOT, dosya).split(path.sep).join("/");
  const sf = ts.createSourceFile(dosya, fs.readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
  const out = new Map<ts.Node, Birim>();
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const ziyaret = (n: ts.Node, dis: ts.Node | null) => {
    const birim = dis ?? (fonksiyonMu(n) ? n : null);
    if (birim && !out.has(birim)) out.set(birim, { anahtar: `${rel}::${birimAdi(birim)}`, ad: birimAdi(birim), dugum: birim, cagrilar: [], elleToplama: [] });
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isIdentifier(n.initializer)) takmaAdlar.push([n.name.text, n.initializer.text]);
    if (birim && ts.isCallExpression(n)) {
      const c = n.expression;
      const ad = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
      if (ad) out.get(birim)!.cagrilar.push({ ad, satir: satir(n), yanit: yanitAlaninda(n, birim) });
      // `<x>.warpBeamEvent.aggregate/groupBy` — kalanı elle toplamanın SQL biçimi.
      if (ts.isPropertyAccessExpression(c) && (ad === "aggregate" || ad === "groupBy") && ts.isPropertyAccessExpression(c.expression) && c.expression.name.text === "warpBeamEvent") {
        out.get(birim)!.elleToplama.push(satir(n));
      }
    }
    ts.forEachChild(n, (k) => ziyaret(k, birim));
  };
  ziyaret(sf, null);
  return [...out.values()];
}

const KILIT_SQL = "SELECT id FROM warp_beams WHERE id = $::uuid FOR UPDATE";
/** Kilitli okuyucunun biçimi; uyumluysa null, değilse sapmanın adı. Metin araması değil — `SKIP LOCKED`, `NOWAIT`, başka
 *  istemci (`prisma`), sıra değişimi ya da araya giren ifade ayrı ayrı yakalanır. */
function kilitliOkuyucuBicimi(fn: ts.Node): string | null {
  if (!ts.isFunctionDeclaration(fn) || !fn.body) return "fonksiyon bildirimi değil";
  const [tx, beamId] = fn.parameters.map((p) => p.name.getText());
  const [s0, s1, ...fazla] = fn.body.statements;
  if (!tx || !beamId) return "parametreler (tx, beamId) değil";
  if (fazla.length) return `fazladan ${fazla.length} ifade`;
  const kilit = s0 && ts.isExpressionStatement(s0) && ts.isAwaitExpression(s0.expression) ? s0.expression.expression : null;
  if (!kilit || !ts.isTaggedTemplateExpression(kilit) || kilit.tag.getText() !== `${tx}.$queryRaw`) return "ilk ifade `await tx.$queryRaw` kilidi değil";
  const t = kilit.template;
  if (!ts.isTemplateExpression(t) || t.templateSpans.length !== 1 || t.templateSpans[0]!.expression.getText() !== beamId) return "kilit tek parametre (beamId) taşımıyor";
  const sql = `${t.head.text}$${t.templateSpans[0]!.literal.text}`.replace(/\s+/g, " ").trim();
  if (sql !== KILIT_SQL) return `kilit SQL'i farklı: "${sql}"`;
  const don = s1 && ts.isReturnStatement(s1) && s1.expression && ts.isCallExpression(s1.expression) ? s1.expression : null;
  if (!don || don.expression.getText() !== "readRemainingM" || don.arguments.map((a) => a.getText()).join(",") !== `${tx},${beamId}`) return "ikinci ifade `return readRemainingM(tx, beamId)` değil";
  return null;
}

function main(): void {
  console.log("=== Levent kalanı — tek kilitli okuyucu (AST) ===\n");
  const hepsi = walkTs(SRC).flatMap(birimler);
  const cagirir = (b: Birim, adlar: Set<string>) => b.cagrilar.filter((c) => adlar.has(c.ad));
  const yazarlar = hepsi.filter((b) => cagirir(b, YAZARLAR).length > 0);

  // Dolaylı okuyucular: kalanı okuyan çekirdekten geçişli kapanış (ad bazlı, muhafazakâr) — kilitli okuyucu hariç.
  const dolayli = new Set(YAZARDA_YASAK);
  for (let buyudu = true; buyudu; ) {
    buyudu = false;
    for (const b of hepsi) {
      if (b.ad === KILITLI_OKUYUCU || dolayli.has(b.ad)) continue;
      if (b.elleToplama.length || b.cagrilar.some((c) => !c.yanit && dolayli.has(c.ad))) (dolayli.add(b.ad), (buyudu = true));
    }
    for (const [takma, asil] of takmaAdlar) if (dolayli.has(asil) && !dolayli.has(takma)) (dolayli.add(takma), (buyudu = true));
  }

  console.log("§1 Yazar birimi kalanı yalnız kilitli okuyucudan alır (dolaylı okuyucular dahil)");
  const ihlal = yazarlar.flatMap((b) => [
    ...b.cagrilar.filter((c) => dolayli.has(c.ad) && !c.yanit).map((c) => `${b.anahtar}:${c.satir} ${c.ad}()`),
    ...b.elleToplama.map((s) => `${b.anahtar}:${s} warpBeamEvent.aggregate/groupBy`),
  ]);
  check("⭐ defter yazan hiçbir birim kalanı kilitsiz/elle/dolaylı okumaz (yalnız yanıtın `data:` alanı gösterimdir)", ihlal.length === 0, ihlal.join(" · "));
  check("dolaylı okuyucu kapanışı kör değil (freshBeamDto ve takma adı freshDto içeride)", dolayli.has("freshBeamDto") && dolayli.has("freshDto"), [...dolayli].filter((a) => !YAZARDA_YASAK.has(a)).join(", "));

  console.log("§2 Toplayıcı ve işaret tablosu yalnız beyanlı birimlerde");
  const toplayan = [...new Set(hepsi.filter((b) => cagirir(b, new Set(["warpBeamRemainingM", "warpBeamLengthSign"])).length > 0).map((b) => b.anahtar))];
  const beyansiz = toplayan.filter((a) => !TOPLAYICI_BEYANI.has(a));
  check("beyansız toplayıcı çağıran birim yok", beyansiz.length === 0, beyansiz.join(" · "));
  const olu = [...TOPLAYICI_BEYANI].filter((a) => !toplayan.includes(a));
  check("beyan listesinde ölü satır yok (her beyanlı birim bugün gerçekten topluyor)", olu.length === 0, olu.join(" · "));

  console.log("§3 Kilitli okuyucunun gövdesi");
  const okuyucu = hepsi.find((b) => b.anahtar === `${LEDGER}::${KILITLI_OKUYUCU}`);
  check(`⭐ ${KILITLI_OKUYUCU} tam iki ifade: aynı tx ile levent satırı FOR UPDATE (bekler), sonra aynı tx'le okuma`, !!okuyucu && kilitliOkuyucuBicimi(okuyucu.dugum) === null, okuyucu ? (kilitliOkuyucuBicimi(okuyucu.dugum) ?? "") : "birim bulunamadı");

  console.log("§4 Körlük sondası");
  const kalanOkuyan = new Set(yazarlar.filter((b) => cagirir(b, new Set([KILITLI_OKUYUCU])).length > 0).map((b) => b.anahtar));
  const eksik = [...KALAN_OKUYAN_YAZARLAR].filter((a) => !kalanOkuyan.has(a));
  const fazla = [...kalanOkuyan].filter((a) => !KALAN_OKUYAN_YAZARLAR.has(a));
  check(`kalanı deftere sokan ${KALAN_OKUYAN_YAZARLAR.size} yazar adıyla bulundu ve kilitli okuyucuyu çağırıyor`, eksik.length === 0, eksik.join(" · "));
  check("beyansız yeni kalan-okuyan yazar yok (eklenirse listeye girer)", fazla.length === 0, fazla.join(" · "));
  check("yazar taraması kör değil (en az 10 birim defter yazıyor)", yazarlar.length >= 10, `${yazarlar.length} birim`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
