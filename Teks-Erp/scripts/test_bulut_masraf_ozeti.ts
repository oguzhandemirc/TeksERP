// =============================================================================
// BEKÇİ — PATRON BULUTU MASRAF ÖZETİ (D4-H2; tasarım DALGA4 §9.8 + §13 D4-H2; kullanıcı kararı S15 a)
// =============================================================================
//   §1 katalog — `ozet-masraf` ANLIK, SAATLIK, izin `bulut:kasa:oku`, modül finance.enabled, okur cash_transactions;
//      bulut kataloğunda (üretilmiş özet) aynı izinle
//   §2 ⭐ statik — kurucu tek kaynaktan okur (getExpenseSummary; prisma/ham SQL/kasa satırı YOK) · tel şemasının
//      anahtar kümesi İZİNLİ küme ile BİREBİR (ham satır / açıklama / belge no / kişi alanı eklenirse kırmızı) ·
//      patron/sunucu `src/`inde alanlara yalnız tel sözleşmesi + katalog dokunur (bulut aritmetik yapmaz) ·
//      uygulamada alanları yalnız görünüm (`lib/expense-summary.ts`) + tel aynası okur; görünümde aritmetik yok
//   §3 ⭐ canlı — 17 kategori: ilk 15 adıyla + "Diğer"; rakamlar helper'la birebir; açıklama metni tele girmez;
//      katı şema yabancı anahtarı reddeder; finans modülü kapalıyken / SAATLIK dışı turda üretilmez
//   §3h/§3i ⭐ (D4-KUC3c) kategori satırı `kategoriAnahtari` taşır; kasa-hareketi türeticisi AYNI anahtarı üretir
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): şemaya + kurucuya kategori satırında `aciklama` alanı eklendi → §2b ❌
//    ve §3e ❌ (exit 1); patron/sunucu/src/services/ altına `buAyToplam` okuyan yardımcı → §2c ❌; uygulama görünümüne
//    `Number(a) + Number(b)` → §2d ❌; geri alındı → yeşil.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; TAG'li kasa + hareketler `finally`de silinir.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SNAPSHOT_PROJECTIONS } from "../src/cloud-sync/projections";
import { SNAPSHOT_WIRE_SCHEMAS, buildSnapshots } from "../src/cloud-sync/snapshots";
import { factoryMonthStart } from "../src/cloud-sync/periods";
import { getExpenseSummary } from "../src/services/helpers/expense-summary.helper";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { cashCategoryKey } from "../src/services/helpers/expense-summary.helper";
import { DERIVERS } from "../src/cloud-sync/derived";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const NAME = "ozet-masraf";
const TAG = `TEST-BMO-${process.pid}`;
const SECRET = `${TAG}-GIZLI-ACIKLAMA`;
const ROOT = path.resolve(__dirname, "../..");
const BUILDER = path.resolve(__dirname, "../src/cloud-sync/snapshot-expense.ts");
const CLOUD_SRC = path.join(ROOT, "patron/sunucu/src");
const CLOUD_SUMMARY = path.join(CLOUD_SRC, "catalog/katalog-ozeti.json");
const APP_DIRS = [path.join(ROOT, "patron/uygulama/src"), path.join(ROOT, "patron/uygulama/app")];
const APP_VIEW = "patron/uygulama/src/lib/expense-summary.ts";
const FIELD_RE = /\b(buAyToplam|gecenAyToplam|buAyPay|kategoriSayisi|digerMi|aylikToplam)\b/;
/** Telde izinli anahtar yolları — kategori METNİ + tutar; ham satır/açıklama/kişi YOK (S15 a). */
const ALLOWED_KEYS = [
  "aylar", "buAy", "gecenAy", "toplam", "buAyToplam", "gecenAyToplam", "fark", "aylikToplam", "aylikToplam.ay", "aylikToplam.tutar",
  "kategoriler", "kategoriler.etiket", "kategoriler.kategoriAnahtari", "kategoriler.digerMi", "kategoriler.kategoriSayisi", "kategoriler.toplam", "kategoriler.buAy",
  "kategoriler.gecenAy", "kategoriler.fark", "kategoriler.buAyPay", "kategoriler.aylik", "kategoriler.aylik.ay", "kategoriler.aylik.tutar",
].sort();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.tsx?$/.test(n)) out.push(f);
  }
  return out;
}

/** Zod şemasının anahtar yolları (nesne → alanlar, dizi → eleman). */
function schemaKeys(s: z.ZodType, prefix = ""): string[] {
  if (s instanceof z.ZodArray) return schemaKeys(s.element as z.ZodType, prefix);
  if (s instanceof z.ZodObject) {
    return Object.entries(s.shape as Record<string, z.ZodType>).flatMap(([k, v]) => [`${prefix}${k}`, ...schemaKeys(v, `${prefix}${k}.`)]);
  }
  return [];
}

function dataKeys(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => dataKeys(x, prefix));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [`${prefix}${k}`, ...dataKeys(x, `${prefix}${k}.`)]);
  return [];
}

const ARITH_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
]);
const NUMERIC_CALLS = new Set(["Number", "parseFloat", "parseInt", "Math", "reduce", "sort"]);

/** Görünümde sayı karşılaştırması / aritmetik / toplama-sıralama (AST; yorum ve metin sayılmaz). */
function arithmeticIn(src: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile("v.ts", src, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && ARITH_OPS.has(n.operatorToken.kind)) out.push(`işleç ${n.getText(sf)}`);
    if (ts.isPrefixUnaryExpression(n) && (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken)) out.push(`işleç ${n.getText(sf)}`);
    if (ts.isIdentifier(n) && NUMERIC_CALLS.has(n.text)) out.push(`çağrı ${n.text}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function katalog(): void {
  console.log("── §1 Katalog ──");
  const p = SNAPSHOT_PROJECTIONS.find((x) => x.name === NAME);
  check("§1a ⭐ ozet-masraf ANLIK · SAATLIK · bulut:kasa:oku · finance.enabled · cash_transactions",
    !!p && p.cadence === "SAATLIK" && p.permission === "bulut:kasa:oku" && p.module === "finance.enabled" && JSON.stringify(p.reads) === '["cash_transactions"]', JSON.stringify(p));
  const cloud = JSON.parse(readFileSync(CLOUD_SUMMARY, "utf8")) as { ROOT_PROJECTIONS: Array<{ name: string; kind: string; permissions: string[] }> };
  const c = cloud.ROOT_PROJECTIONS.find((x) => x.name === NAME);
  check("§1b bulut kataloğunda aynı ad ANLIK + bulut:kasa:oku", !!c && c.kind === "ANLIK" && JSON.stringify(c.permissions) === '["bulut:kasa:oku"]', JSON.stringify(c));
}

function statik(): void {
  console.log("── §2 Statik ──");
  const b = readFileSync(BUILDER, "utf8");
  check("§2a ⭐ kurucu tek kaynaktan okur (getExpenseSummary); prisma / ham SQL / kasa satırı yok",
    b.includes("getExpenseSummary(") && !/lib\/prisma|\$queryRaw|cash_transactions|cashTransaction|description|docNo/.test(b));
  const keys = [...new Set(schemaKeys(SNAPSHOT_WIRE_SCHEMAS[NAME]!))].sort();
  const extra = keys.filter((k) => !ALLOWED_KEYS.includes(k));
  const missing = ALLOWED_KEYS.filter((k) => !keys.includes(k));
  check("§2b ⭐ tel şeması anahtarları izinli kümeyle BİREBİR (ham satır/açıklama/kişi yok)", extra.length === 0 && missing.length === 0,
    [extra.length ? `fazla: ${extra.join(",")}` : "", missing.length ? `eksik: ${missing.join(",")}` : ""].filter(Boolean).join(" · ") || `${keys.length} anahtar`);
  const allowedCloud = new Set(["patron/sunucu/src/wire/api.ts"]);
  const cloudExtra = walk(CLOUD_SRC).filter((f) => FIELD_RE.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).filter((f) => !allowedCloud.has(f));
  check("§2c ⭐ patron/sunucu alanlara yalnız tel sözleşmesinde dokunur (bulut hesap/süzme yapmaz)", cloudExtra.length === 0, cloudExtra.join(", ") || "temiz");
  // Genel adlı alanlar (toplam/fark) FIELD_RE'ye girmez; anlık adı katalog + tel dışında geçmiyorsa bulut veriyi hiç okumaz.
  const nameAllowed = new Set(["patron/sunucu/src/wire/api.ts", "patron/sunucu/src/catalog/projections.ts", "patron/sunucu/src/catalog/katalog-ozeti.json"]);
  const nameExtra = walk(CLOUD_SRC).filter((f) => readFileSync(f, "utf8").includes(NAME)).map((f) => path.relative(ROOT, f)).filter((f) => !nameAllowed.has(f));
  check("§2c2 ⭐ patron/sunucu'da anlık adı yalnız katalog + tel dosyalarında geçer", nameExtra.length === 0, nameExtra.join(", ") || "temiz");
  const allowedApp = new Set([APP_VIEW, "patron/uygulama/src/api/wire.ts"]);
  const appExtra = APP_DIRS.flatMap(walk).filter((f) => FIELD_RE.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).filter((f) => !allowedApp.has(f));
  const arith = arithmeticIn(readFileSync(path.join(ROOT, APP_VIEW), "utf8"));
  check("§2d ⭐ uygulamada alanları yalnız görünüm okur; görünümde aritmetik/karşılaştırma/toplama yok",
    appExtra.length === 0 && arith.length === 0, [...appExtra, ...arith].join(", ") || "temiz");
}

async function canli(ids: { box: string }): Promise<void> {
  console.log("\n── §3 Canlı ──");
  const now = new Date();
  const lastMonthDay = new Date(factoryMonthStart(now, -1).getTime() + 3 * 86_400_000);
  ids.box = (await prisma.cashBox.create({ data: { code: `${TAG}-K`, name: `${TAG} kasa`, currency: "TRY" }, select: { id: true } })).id;
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: ids.box, amount: 900_000_000, txnDate: factoryMonthStart(now, -2) });
  const cat = (i: number) => `${TAG}-K${String(i).padStart(2, "0")}`;
  // Büyük tutar: TAG kategorileri ortamdaki her kategorinin önünde (körlük zemini: Diğer'in içi helper'la ölçülür).
  for (let i = 0; i < 17; i++) {
    await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: ids.box, amount: 50_000_000 - i * 1_000_000, txnDate: now, category: cat(i), description: SECRET });
  }
  await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: ids.box, amount: 10_000_000, txnDate: lastMonthDay, category: cat(0), description: SECRET });
  // Boşluklu yazım aynı kategoridir (anahtar fabrikada kırpılır); iki ay önceye: §3d'nin bu/geçen ay rakamı değişmez.
  await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: ids.box, amount: 1, txnDate: new Date(factoryMonthStart(now, -2).getTime() + 3 * 86_400_000), category: `  ${cat(0)} `, description: SECRET });

  const snaps = await buildSnapshots({ now, productionOn: true, financeOn: true, cadences: new Set(["SAATLIK"]) });
  const snap = snaps.find((s) => s.projection === NAME);
  const d = snap?.data as unknown as {
    buAy: string; buAyToplam: string; fark: string; aylar: string[];
    kategoriler: Array<{ etiket: string; kategoriAnahtari: string | null; digerMi: boolean; kategoriSayisi: number; buAy: string; gecenAy: string; fark: string; buAyPay: number }>;
  } | undefined;
  check("§3a SAATLIK turda üretilir, 12 ay", !!d && d.aylar.length === 12, JSON.stringify(d?.aylar));
  if (!d) return;
  const summary = await getExpenseSummary({ range: { from: factoryMonthStart(now, -11), to: now } });
  const named = d.kategoriler.filter((k) => !k.digerMi);
  const other = d.kategoriler.find((k) => k.digerMi);
  check("§3b ⭐ ilk 15 adıyla (TAG sırası) + tek 'Diğer' (kalan kategori sayısı helper'la)",
    named.length === 15 && named.every((k, i) => k.etiket === cat(i)) && d.kategoriler.length === 16 && other?.etiket === "Diğer" &&
    other.kategoriSayisi === summary.categories.length - 15, `${named.length} + ${other?.kategoriSayisi}/${summary.categories.length - 15}`);
  const rest = summary.categories.slice(15);
  const restNow = rest.reduce((s, c) => s.plus(new Prisma.Decimal(c.cells.find((x) => x.month === d.buAy)?.amountTry ?? "0")), new Prisma.Decimal(0));
  const monthTotal = summary.monthTotals.find((m) => m.month === d.buAy)?.amountTry;
  check("§3c ⭐ toplama fabrikada: Diğer bu ay = kalanların toplamı; ay toplamı = helper", other?.buAy === restNow.toFixed(2) && d.buAyToplam === monthTotal,
    `${other?.buAy}/${restNow.toFixed(2)} · ${d.buAyToplam}/${monthTotal}`);
  const k0 = named[0];
  check("§3d geçen aya göre fark fabrikada (50M − 10M = 40M) + pay", k0?.buAy === "50000000.00" && k0.gecenAy === "10000000.00" && k0.fark === "40000000.00" && k0.buAyPay > 0 && k0.buAyPay <= 100,
    JSON.stringify(k0));
  check("§3h ⭐ kategori satırı fabrika anahtarını taşır (cashCategoryKey); 'Diğer'de null",
    named.every((k) => k.kategoriAnahtari === cashCategoryKey(k.etiket).key) && other?.kategoriAnahtari === null, `${named[0]?.kategoriAnahtari} · ${other?.kategoriAnahtari}`);
  // Patron kasa listesinin süzgeci (D4-KUC3c) kasa-hareketi `kategoriAnahtari` eşitliğidir: iki yüzey AYNI anahtarı üretmeli.
  const txs = await prisma.cashTransaction.findMany({ where: { cashBoxId: ids.box, category: { contains: cat(0) } }, select: { id: true, category: true } });
  // Servis yazımda kırpar; eski/elle girilmiş boşluklu satırı türeticinin kendisi kırpmalı → sentetik satır.
  const legacy = { id: "legacy-padded", category: `  ${cat(0)} ` };
  const derivedKeys = await DERIVERS["kasa-hareketi"]!([...txs, legacy], now.getTime());
  const txKeys = [...derivedKeys.values()].map((v) => v.kategoriAnahtari);
  check("§3i ⭐ kasa-hareketi kategoriAnahtari = özet satırının anahtarı (boşluklu yazım dahil)",
    txs.length === 3 && txKeys.length === 4 && txKeys.every((x) => x === k0?.kategoriAnahtari), JSON.stringify(txKeys));
  const keys = [...new Set(dataKeys(snap!.data))].sort();
  const raw = JSON.stringify(snap!.data);
  check("§3e ⭐ tel yalnız izinli anahtarlar; serbest açıklama metni GİTMEZ", keys.every((k) => ALLOWED_KEYS.includes(k)) && !raw.includes(SECRET),
    keys.filter((k) => !ALLOWED_KEYS.includes(k)).join(",") || "temiz");
  const bad = SNAPSHOT_WIRE_SCHEMAS[NAME]!.safeParse({ ...(snap!.data as object), satirlar: [{ aciklama: SECRET }] });
  check("§3f katı şema yabancı anahtarı (ham satır) reddeder", !bad.success);
  const off = await buildSnapshots({ now, productionOn: true, financeOn: false, cadences: new Set(["SAATLIK"]) });
  const everyRound = await buildSnapshots({ now, productionOn: true, financeOn: true, cadences: new Set(["HER_TUR"]) });
  check("§3g finans kapalıyken ve SAATLIK dışı turda üretilmez", !off.some((s) => s.projection === NAME) && !everyRound.some((s) => s.projection === NAME));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== PATRON BULUTU MASRAF ÖZETİ BEKÇİSİ ===\n");
  katalog();
  statik();
  const ids = { box: "" };
  try {
    await canli(ids);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    if (ids.box) {
      await prisma.cashTransaction.deleteMany({ where: { cashBoxId: ids.box } });
      await prisma.cashBox.deleteMany({ where: { id: ids.box } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
