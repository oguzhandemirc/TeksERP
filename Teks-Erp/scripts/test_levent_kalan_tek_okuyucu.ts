// =============================================================================
// Bekçi: LEVENT KALANI — defter yazan her yol kalanı TEK kilitli okuyucudan alır (DB'siz, AST)
// Çalıştır: npx tsx scripts/test_levent_kalan_tek_okuyucu.ts
// =============================================================================
// NEDEN: kalan metre kolon değil, olaylardan türetilir. Kalanı kilitsiz okuyan bir yazar, eşzamanlı ikinci
// yazımla aynı eski kalanı görür ve kalan eksiye düşer (`TOKEN-REPLAY-KILIDI.md` §5-6; zorlanmış sırada
// ölçüldü 2026-09-26: iki 60 m tüketim, kalan 100 → −20). Çare TEK okuyucu: `remainingMTx` önce levent satırını
// `FOR UPDATE` kilitler, sonra okur. Bu bekçi kuralı YAPISAL ölçer (AST, fonksiyon birimi başına):
//   §1 levent defterine yazan her fonksiyon birimi (`applyWarpBeamEventTx` / `closeToMeasuredTx` çağıran)
//      kalanı yalnız `remainingMTx`ten okur — gösterim okuyucusu, toplayıcı ya da işaret tablosu çağırmaz,
//      olay tablosunu elle toplamaz.
//   §2 toplayıcı (`warpBeamRemainingM`) ve işaret tablosu (`warpBeamLengthSign`) yalnız beyanlı birimlerde.
//   §3 `remainingMTx` gövdesinde satır kilidi VAR ve okumadan ÖNCE.
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
  "src/services/warp-beam-mount.service.ts::mountBeam",
]);

type Birim = { anahtar: string; dugum: ts.Node; cagrilar: Array<{ ad: string; satir: number }>; elleToplama: number[] };

function birimAdi(n: ts.Node): string {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
  if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
  if (ts.isPropertyAssignment(n.parent)) return n.parent.name.getText();
  return `<anonim:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}>`;
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
    if (birim && !out.has(birim)) out.set(birim, { anahtar: `${rel}::${birimAdi(birim)}`, dugum: birim, cagrilar: [], elleToplama: [] });
    if (birim && ts.isCallExpression(n)) {
      const c = n.expression;
      const ad = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
      if (ad) out.get(birim)!.cagrilar.push({ ad, satir: satir(n) });
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

function main(): void {
  console.log("=== Levent kalanı — tek kilitli okuyucu (AST) ===\n");
  const hepsi = walkTs(SRC).flatMap(birimler);
  const cagirir = (b: Birim, adlar: Set<string>) => b.cagrilar.filter((c) => adlar.has(c.ad));
  const yazarlar = hepsi.filter((b) => cagirir(b, YAZARLAR).length > 0);

  console.log("§1 Yazar birimi kalanı yalnız kilitli okuyucudan alır");
  const ihlal = yazarlar.flatMap((b) => [
    ...cagirir(b, YAZARDA_YASAK).map((c) => `${b.anahtar}:${c.satir} ${c.ad}()`),
    ...b.elleToplama.map((s) => `${b.anahtar}:${s} warpBeamEvent.aggregate/groupBy`),
  ]);
  check("⭐ defter yazan hiçbir birim kalanı kilitsiz/elle okumaz", ihlal.length === 0, ihlal.join(" · "));

  console.log("§2 Toplayıcı ve işaret tablosu yalnız beyanlı birimlerde");
  const toplayan = [...new Set(hepsi.filter((b) => cagirir(b, new Set(["warpBeamRemainingM", "warpBeamLengthSign"])).length > 0).map((b) => b.anahtar))];
  const beyansiz = toplayan.filter((a) => !TOPLAYICI_BEYANI.has(a));
  check("beyansız toplayıcı çağıran birim yok", beyansiz.length === 0, beyansiz.join(" · "));
  const olu = [...TOPLAYICI_BEYANI].filter((a) => !toplayan.includes(a));
  check("beyan listesinde ölü satır yok (her beyanlı birim bugün gerçekten topluyor)", olu.length === 0, olu.join(" · "));

  console.log("§3 Kilitli okuyucunun gövdesi");
  const okuyucu = hepsi.find((b) => b.anahtar === `${LEDGER}::${KILITLI_OKUYUCU}`);
  const govde = okuyucu ? okuyucu.dugum.getText() : "";
  const kilit = govde.search(/SELECT[^`]*FROM\s+warp_beams[^`]*FOR UPDATE/);
  const okuma = govde.indexOf("readRemainingM(");
  check(`⭐ ${KILITLI_OKUYUCU} levent satırını FOR UPDATE kilitler, sonra okur`, !!okuyucu && kilit >= 0 && okuma > kilit, okuyucu ? `kilit@${kilit} okuma@${okuma}` : "birim bulunamadı");

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
