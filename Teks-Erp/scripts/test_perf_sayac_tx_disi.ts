// =============================================================================
// Test: Top barkod sayacı tx DIŞINDA — AST cırcırı (Perf-4 B-01)
// Çalıştır: npx tsx scripts/test_perf_sayac_tx_disi.ts
//           npx tsx scripts/test_perf_sayac_tx_disi.ts --sonda=<ad>   (KALICI sondalar)
// =============================================================================
// `roll_barcode_counters` satır kilidi, artışı yapan tx COMMIT edene kadar tutulur;
// sayaç bir tx'in içinde artırılırsa bütün top girişleri o satırda kuyruğa girer.
// Bu bekçi sayaç helper'ının (generateRollBarcodeTx · reserveRollBarcodesTx ·
// reserveRollBarcodesInOrderTx) ve sayaç satırlı seri rezervasyonunun (reserveSeriesNo ·
// reserveDoffCode — Perf-4 B-03) bir tx BAĞLAMINDA çağrılmasını AST ile sayar:
//   · `$transaction(...)` callback'inin içinde (argüman tx de olsa prisma da olsa —
//     havuz client'ı tx açıkken ikinci bağlantı ister, o da ayrı bir kusurdur);
//   · parametresi tx client tipli (`TransactionClient`/`TxClient`) ya da `tx` adlı bir fonksiyonun içinde.
// Dosya başına sayı TABAN'a karşı cırcırdır: artış her yerde sert; çürüme commit
// kapısında uyarı, CI'da sert (`lib/circir-kolu.ts`). KK1, tambur ve doff dosyaları SIFIR.
// `test_barcode_reservation` aynı soruyu regex ile ve yalnız `(tx` argümanıyla
// sorar; bu bekçi bağlamı ölçer (prisma ile tx içinde çağrıyı da yakalar).
//
// KALICI sondalar (her biri kırmızı vermeli; ölçüldü — sayılar harita satırında):
//   --sonda=ihlal   → inventory.service.ts'e sentetik tx-içi çağrı eklenir: §2 kırmızı
//   --sonda=artis   → TABAN'lı dosyaya (subcontractor) bir tx-içi çağrı eklenir: §3b artış kırmızı
//   --sonda=duzelt  → TABAN'lı bir dosyanın bir çağrısı "düzeltilmiş" sayılır: §3 çürüme kırmızı
//   --sonda=kor     → tarayıcı hiçbir çağrı bulamaz: §1 körlük zemini kırmızı
//   --sonda=doff    → machine-doff.service.ts'e sentetik tx-içi `reserveDoffCode` eklenir: §2 kırmızı
// Gerekli mi: KK1 ilk giriş ve rescueStuckRoll sayacı tx içinde artırıyordu (Perf-4 B-01);
// düzeltildi, bekçi geri dönüşü yakalar; gerekçe ve önce/sonra tablosu arşiv notunda.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";

const SRC = path.join(__dirname, "..", "src");
const HELPER_FILES = new Set(["services/helpers/roll-barcode.helper.ts", "services/helpers/series-counter-store.helper.ts"]);
const COUNTER_FNS = new Set([
  "generateRollBarcodeTx", "reserveRollBarcodesTx", "reserveRollBarcodesInOrderTx",
  "reserveSeriesNo", "reserveDoffCode", // sayaç satırlı seri (B-03): tx'e bağlanırsa satır kilidi commit'e kadar sürer
]);

/** Sayacı tx İÇİNDE artırmaya devam eden yollar — sayı yalnız DÜŞER (entegratör yazar). */
const TABAN: Record<string, number> = {
  "services/subcontractor.service.ts": 2, // fason çıkış (tekil) + fason kabul (toplu)
  "services/workorder-batch-drop.service.ts": 1, // barkodsuz küme claim'den sonra okunuyor
  "services/helpers/roll-finalize.helper.ts": 1, // top listesi tx içinde hesaplanıyor
  "services/helpers/roll-disposition.helper.ts": 1, // barkodsuz küme claim'den sonra okunuyor
};
/** Bu dosyalarda tx-içi sayaç çağrısı KALMAMALI (KK1 B-01 ve tambur düzeltmesi). */
const MUST_BE_CLEAN = ["services/inventory.service.ts", "services/tambur.service.ts", "services/machine-doff.service.ts"];

const MIN_FILES_SCANNED = 100;
const MIN_COUNTER_CALLS = 8; // bugün 12 çağrı (tx dışı dahil); zemin rahat aşağıda

const SONDA = (process.argv.find((a) => a.startsWith("--sonda=")) ?? "").slice("--sonda=".length);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function isFunctionLike(n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
}

/** Fonksiyon bir tx bağlamı mı: `$transaction` callback'i ya da TransactionClient parametreli. */
function isTxContext(fn: ts.Node, sf: ts.SourceFile): boolean {
  const parent = fn.parent;
  if (parent && ts.isCallExpression(parent) && parent.arguments.includes(fn as ts.Expression)) {
    const callee = parent.expression.getText(sf);
    if (/\$transaction$/.test(callee)) return true;
  }
  if (isFunctionLike(fn)) {
    for (const p of fn.parameters) {
      // Parametrenin KENDİ tipi tx client'ı (ya da adı `tx`) — iç içe tipteki geçiş sayılmaz.
      const tip = p.type?.getText(sf) ?? "";
      if (/^(Prisma\.)?(TransactionClient|TxClient|Tx)$/.test(tip)) return true;
      if (ts.isIdentifier(p.name) && p.name.text === "tx") return true;
    }
  }
  return false;
}

interface Tarama {
  txIci: Array<{ satir: number; fn: string }>;
  toplam: number;
}

/** Saf tarayıcı — kaynak metni alır, sayaç çağrılarını ve tx-içi olanları döndürür. */
function tara(src: string, ad: string): Tarama {
  const sf = ts.createSourceFile(ad, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Tarama = { txIci: [], toplam: 0 };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && COUNTER_FNS.has(n.expression.text)) {
      out.toplam++;
      for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
        if (isFunctionLike(a) && isTxContext(a, sf)) {
          out.txIci.push({ satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, fn: n.expression.text });
          break;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function main(): void {
  // ── §0 tarayıcının kendi sondaları (bellek içi, her koşumda) ──
  const s1 = tara(`async function f(){ await prisma.$transaction(async (tx) => { await generateRollBarcodeTx(tx, "H"); }); }`, "s1.ts");
  check("§0a $transaction callback'inde tx argümanlı çağrı yakalanır", s1.txIci.length === 1);
  const s2 = tara(`async function f(){ await prisma.$transaction(async (tx) => { const b = await generateRollBarcodeTx(prisma, "H"); }); }`, "s2.ts");
  check("§0b $transaction callback'inde HAVUZ client'ıyla çağrı da yakalanır", s2.txIci.length === 1);
  const s3 = tara(`async function f(){ const b = await generateRollBarcodeTx(prisma, "H"); await prisma.$transaction(async (tx) => { await tx.roll.create({ data: { barcode: b } }); }); }`, "s3.ts");
  check("§0c tx AÇILMADAN ÖNCE çağrı ihlal sayılmaz", s3.txIci.length === 0 && s3.toplam === 1);
  const s4 = tara(`export async function g(tx: Prisma.TransactionClient){ return reserveRollBarcodesTx(tx, "F", 3); }`, "s4.ts");
  check("§0d TransactionClient parametreli helper içindeki çağrı yakalanır", s4.txIci.length === 1);
  const s5 = tara(`async function f(){ await withBarcodeRetry(() => prisma.$transaction(async (tx) => { const c = await reserveDoffCode(d); })); }`, "s5.ts");
  const s6 = tara(`async function f(){ await withBarcodeRetry(async () => { const c = await reserveDoffCode(d); return prisma.doffEvent.create({}); }); }`, "s6.ts");
  check("§0e sayaç satırlı seri: tx içinde rezervasyon yakalanır, tx dışında sayılmaz", s5.txIci.length === 1 && s6.txIci.length === 0 && s6.toplam === 1);

  // ── gerçek tarama ──
  const dosyalar = walk(SRC);
  const bulunan: Record<string, Array<{ satir: number; fn: string }>> = {};
  let toplamCagri = 0;
  for (const f of dosyalar) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    if (HELPER_FILES.has(rel)) continue; // tanımlayan dosya: kendi içindeki sarmalayıcı zinciri sayılmaz
    const src = fs.readFileSync(f, "utf8");
    if (!/RollBarcode|reserveRollBarcodes|reserveSeriesNo|reserveDoffCode/.test(src)) continue;
    const t = tara(src, rel);
    toplamCagri += t.toplam;
    if (t.txIci.length) bulunan[rel] = t.txIci;
  }
  if (SONDA === "ihlal") {
    const t = tara(`async function f(){ await prisma.$transaction(async (tx) => { await generateRollBarcodeTx(tx, "H"); }); }`, "sonda.ts");
    bulunan["services/inventory.service.ts"] = [...(bulunan["services/inventory.service.ts"] ?? []), ...t.txIci];
  }
  if (SONDA === "doff") {
    const t = tara(`async function f(){ await prisma.$transaction(async (tx) => { await reserveDoffCode(new Date()); }); }`, "sonda.ts");
    bulunan["services/machine-doff.service.ts"] = [...(bulunan["services/machine-doff.service.ts"] ?? []), ...t.txIci];
  }
  if (SONDA === "artis") {
    const t = tara(`async function f(tx: Prisma.TransactionClient){ await reserveRollBarcodesTx(tx, "H", 2); }`, "sonda.ts");
    const k = "services/subcontractor.service.ts";
    bulunan[k] = [...(bulunan[k] ?? []), ...t.txIci];
  }
  if (SONDA === "duzelt") {
    const k = Object.keys(TABAN).find((f) => bulunan[f]?.length);
    if (k) bulunan[k] = bulunan[k]!.slice(1);
  }
  if (SONDA === "kor") {
    toplamCagri = 0;
    for (const k of Object.keys(bulunan)) delete bulunan[k];
  }

  // ── §1 körlük zemini ──
  check(`§1a taranan dosya ≥ ${MIN_FILES_SCANNED}`, dosyalar.length >= MIN_FILES_SCANNED, `${dosyalar.length}`);
  check(`§1b bulunan sayaç çağrısı ≥ ${MIN_COUNTER_CALLS}`, toplamCagri >= MIN_COUNTER_CALLS, `${toplamCagri}`);

  // ── §2 temiz kalması gereken dosyalar ──
  for (const f of MUST_BE_CLEAN) {
    const h = bulunan[f] ?? [];
    check(`§2 ${f} içinde tx-içi sayaç çağrısı YOK`, h.length === 0, h.map((x) => `:${x.satir} ${x.fn}`).join(", "));
  }

  // ── §3 cırcır: artış sert, çürüme curumeKolu ──
  const yeni = Object.keys(bulunan).filter((f) => !(f in TABAN) && !MUST_BE_CLEAN.includes(f));
  check("§3a TABAN dışı dosyada tx-içi sayaç çağrısı YOK (yeni ihlal)", yeni.length === 0, yeni.map((f) => `${f}${bulunan[f]!.map((x) => `:${x.satir}`).join("")}`).join(" · "));
  for (const [f, taban] of Object.entries(TABAN)) {
    const gercek = bulunan[f]?.length ?? 0;
    check(`§3b ${f} artış yok (≤ ${taban})`, gercek <= taban, `gerçek ${gercek}`);
    curumeKolu(check, ATLAMA.atla, `§3c ${f} taban çürümedi (düştüyse TABAN'ı düşür)`, gercek, taban);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
