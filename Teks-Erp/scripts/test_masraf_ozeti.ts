// =============================================================================
// MASRAF ÖZETİ bekçisi (D4-H1; ister 4.3/5.3, K18)
// =============================================================================
// §1 ⭐ iptalli fikstürde aynı aralıkta Σ masraf özeti = kasa defteri EXPENSE toplamı
// §2 ⭐ iptal İPTAL AYINDA eksi; asıl ay değişmez; aralık öncesi masrafın iptali yalnız eksi
// §3 ⭐ sıralama TL azalan + eşitlikte anahtar; trim birleştirir, harf katlanmaz; boş → Kategorisiz
// §4 sunum zarfı: tablo toplamı = ana sayı = helper toplamı; ay kolonları = ay toplamları (ekran/Excel/PDF aynı tablo)
// §5 ⭐ AST: `CAT:` kategori anahtarı yalnız `expense-summary.helper.ts`te yazılır
// §6 öneri ucu: ayar ON → son kategoriler; OFF → enabled:false, boş liste; ayar birebir geri yüklenir
// §7 ⭐ varyant `paraBirimi`: hücre = asıl para birimiyle süzülmüş özet (TL karşılığı), Σ hücre = ana sayı; şema kapalı küme
// §8 anlatı: "En büyük pay <kategori>: <tutar> (toplamın %<pay>'ı)." — boş dönemde ve eksi toplamlı kategoride cümle YOK
// Fikstür 2019 aylarında (başka veri o aylara düşmez); iptal anı fikstürde 2019'a taşınır (servis iptali `now()` yazar).
// NEGATİF SONDA (2026-10-29): helper'dan iptal kolu (UNION ALL 2. dal) silindi → §1/§2 ❌;
// cash-book `bucketOf`a `CAT:` literali geri yazıldı → §5 ❌; ikisi de geri alındı → ✅.
// (2026-10-30) para birimi süzgeci `Prisma.empty` yapıldı → §7a/§7b/§7c ❌; sunum `anlati: []` → §8a ❌; geri alındı → 28/0.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import prisma from "../src/lib/prisma";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { getCashBookReport } from "../src/services/reports/cash-book.report";
import {
  cashCategoryKey,
  expenseCategorySuggestions,
  getExpenseSummary,
  UNCATEGORIZED_LABEL,
} from "../src/services/helpers/expense-summary.helper";
import { buildExpenseSummarySunumu, expenseSummaryNarrative, monthColumnKey } from "../src/services/reports/expense-summary.sunum";
import { EXPENSE_SUMMARY_DIMS } from "../src/services/reports/temel/core-runs";
import { expenseSummaryRunner } from "../src/services/reports/expense-summary.run";
import { runCoreWithExtras } from "../src/services/reports/temel/_variant";
import { expenseSummaryQuerySchema } from "../src/routes/reports/finance.report.routes";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { factoryDayStartOfKey } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-MOZ-${process.pid}`;
const boxIds: string[] = [];
/** Fabrika gününün öğlesi — ay sınırına yakın saat dilimi oyunlarından uzak. */
const day = (ymd: string): Date => new Date(factoryDayStartOfKey(ymd).getTime() + 12 * 3_600_000);

async function expense(boxId: string, amount: number, ymd: string, category: string | null): Promise<string> {
  const r = await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: boxId, amount, txnDate: day(ymd), category });
  return r.data!.id;
}

/** Servis iptali (durum geçişi + ters bakiye) — sonra iptal anı fikstür ayına taşınır. */
async function cancelAt(id: string, ymd: string): Promise<void> {
  await cashTransactionService.cancel(id, "test iptali");
  await prisma.cashTransaction.update({ where: { id }, data: { cancelledAt: day(ymd) } });
}

function scanCategoryKeyLiterals(root: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!full.endsWith(".ts") || full.endsWith(path.join("helpers", "expense-summary.helper.ts"))) continue;
      const src = ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node): void => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
          && n.text.includes("CAT:")) {
          hits.push(`${path.relative(root, full)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(src);
    }
  };
  walk(root);
  return hits;
}

async function temizle(): Promise<void> {
  if (boxIds.length === 0) return;
  await prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: boxIds } } });
  await prisma.cashBox.deleteMany({ where: { id: { in: boxIds } } });
}

async function main(): Promise<void> {
  // §5 DB'siz: önce koşar.
  console.log("\n── §5 tek kategori anahtarı (AST) ──");
  const hits = scanCategoryKeyLiterals(path.join(__dirname, "..", "src"));
  check("§5 ⭐ `CAT:` anahtarı yalnız expense-summary.helper.ts'te (ikinci anahtar kuralı yok)", hits.length === 0, hits.join(", ") || "0 ihlal");
  check("§5b körlük zemini: helper anahtarı `CAT:` önekli", cashCategoryKey(" Kira ").key === "CAT:Kira" && cashCategoryKey(null).label === UNCATEGORIZED_LABEL);

  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB", false, engel); return; }

  const box = await prisma.cashBox.create({ data: { code: `${TAG}-K`, name: `${TAG} kasa`, currency: "TRY" }, select: { id: true } });
  boxIds.push(box.id);
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 100000, txnDate: day("2018-11-01") });

  // Fikstür: Ocak–Mart 2019.
  const before = await expense(box.id, 700, "2018-12-20", "Nakliye"); // aralık öncesi, Şubat'ta iptal
  await cancelAt(before, "2019-02-05");
  await expense(box.id, 1000, "2019-01-10", " Kira "); // trim → "Kira"
  await expense(box.id, 1000, "2019-02-10", "Kira");
  await expense(box.id, 300, "2019-01-12", "kira"); // harf katlanmaz → ayrı satır
  const janCancelled = await expense(box.id, 400, "2019-01-15", "Elektrik"); // Ocak asıl, Mart iptal
  await cancelAt(janCancelled, "2019-03-02");
  const sameMonth = await expense(box.id, 250, "2019-03-03", "Yakıt"); // aynı ay iptal → net 0
  await cancelAt(sameMonth, "2019-03-20");
  await expense(box.id, 500, "2019-02-11", "Bakım"); // Elektrik ile eşit değil; eşitlik çifti aşağıda
  await expense(box.id, 500, "2019-03-11", "Aidat"); // Bakım ile eşit (500) → anahtar sırası
  await expense(box.id, 90, "2019-03-12", null); // Kategorisiz
  await cashTransactionService.create({ kind: "INCOME", cashBoxId: box.id, amount: 5000, txnDate: day("2019-01-20"), category: "Kira" }); // gelir girmez

  const window = resolveCoreDayRange({ from: "2019-01-01", to: "2019-03-31", kiyas: "none" }, 90);
  const s = await getExpenseSummary({ range: window.range });

  console.log("\n── §1 Σ özet = kasa defteri EXPENSE ──");
  const book = await getCashBookReport({ range: window.range, accountId: box.id });
  let bookExpense = 0;
  const expenseIds = new Set((await prisma.cashTransaction.findMany({ where: { cashBoxId: box.id, kind: "EXPENSE" }, select: { id: true } })).map((r) => r.id));
  for (const r of book.rows ?? []) {
    if (!expenseIds.has(r.id.replace(/:C$/, ""))) continue;
    bookExpense += r.direction === "OUT" ? Number(r.amount) : -Number(r.amount);
  }
  check("§1 ⭐ Σ masraf özeti = kasa defteri EXPENSE (çıkan − iptal girişi)", Number(s.totalTry) === Math.round(bookExpense * 100) / 100, `özet ${s.totalTry} · defter ${bookExpense.toFixed(2)}`);
  check("§1b körlük zemini: fikstür sıfır değil", Number(s.totalTry) > 0 && (book.rows?.length ?? 0) >= 10, `${book.rows?.length} defter satırı`);
  check("§1c beklenen toplam 1000+1000+300+400+500+500+90 − 700 − 400 = 2690", s.totalTry === "2690.00", s.totalTry);

  console.log("\n── §2 iptal ayı ──");
  const cell = (label: string, month: string): string | undefined =>
    s.categories.find((c) => c.label === label)?.cells.find((x) => x.month === month)?.amountTry;
  check("§2a ⭐ Elektrik: Ocak +400 (asıl ay değişmedi)", cell("Elektrik", "2019-01") === "400.00", String(cell("Elektrik", "2019-01")));
  check("§2b ⭐ Elektrik: Mart −400 (iptal ayı)", cell("Elektrik", "2019-03") === "-400.00", String(cell("Elektrik", "2019-03")));
  check("§2c ⭐ Nakliye: aralık öncesi masrafın iptali Şubat'ta yalnız −700", cell("Nakliye", "2019-02") === "-700.00" && cell("Nakliye", "2019-01") === undefined);
  check("§2d Yakıt aynı ay iptal → Mart net 0, 1 fiş 1 iptal", (() => {
    const y = s.categories.find((c) => c.label === "Yakıt");
    return y?.totalTry === "0.00" && y.expenseCount === 1 && y.cancelCount === 1;
  })());
  check("§2e aylar Ocak–Mart, ay toplamları = Σ hücre", JSON.stringify(s.months) === JSON.stringify(["2019-01", "2019-02", "2019-03"])
    && s.monthTotals.reduce((a, m) => a + Number(m.amountTry), 0) === Number(s.totalTry));

  console.log("\n── §3 sıralama + anahtar ──");
  const order = s.categories.map((c) => `${c.label}:${c.totalTry}`);
  check("§3a ⭐ TL azalan, eşitlikte anahtar (Aidat < Bakım)", JSON.stringify(order) === JSON.stringify([
    "Kira:2000.00", "Aidat:500.00", "Bakım:500.00", "kira:300.00", "Kategorisiz:90.00", "Elektrik:0.00", "Yakıt:0.00", "Nakliye:-700.00",
  ]), order.join(" · "));
  check("§3b trim birleştirir (\" Kira \" + \"Kira\" tek satır), \"kira\" ayrı", s.categories.filter((c) => c.label.toLowerCase() === "kira").length === 2);
  check("§3c gelir (INCOME) özete girmez", !s.categories.some((c) => c.label === "Kira" && Number(c.totalTry) > 2000));

  console.log("\n── §4 sunum zarfı ──");
  const sunum = buildExpenseSummarySunumu(s, window, null);
  const t = sunum.tablo!;
  check("§4a ⭐ tablo toplamı = ana sayı = helper toplamı", t.toplam?.toplam === 2690 && sunum.anaSayi.deger === 2690);
  check("§4b ay kolonu toplamı = Σ satır (her ay)", s.months.every((m) => {
    const k = monthColumnKey(m);
    const sum = t.satirlar.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    return Math.abs(sum - Number(t.toplam?.[k])) < 0.001;
  }));
  check("§4c satır sırası helper sırası", JSON.stringify(t.satirlar.map((r) => r.kategori)) === JSON.stringify(s.categories.map((c) => c.label)));
  check("§4d iptal uyarısı günlük dilde", sunum.uyarilar.some((u) => u.includes("iptal edildiği ayda eksi")));
  check("§4e para birimi süzgeci beyanlı (varyant hücresinin yazdığı anahtar)", sunum.parametreler.some((p) => p.ad === "currency" && p.deger === null));

  console.log("\n── §7 para birimi varyantı ──");
  const usdBox = await prisma.cashBox.create({ data: { code: `${TAG}-U`, name: `${TAG} döviz kasa`, currency: "USD" }, select: { id: true } });
  boxIds.push(usdBox.id);
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: usdBox.id, amount: 1000, exchangeRate: 30, txnDate: day("2018-11-01") });
  await expense(box.id, 200, "2019-05-10", "Kira");
  await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: usdBox.id, amount: 10, exchangeRate: 30, txnDate: day("2019-05-12"), category: "Kargo" });
  const may = resolveCoreDayRange({ from: "2019-05-01", to: "2019-05-31", kiyas: "none" }, 90);
  let detail: Awaited<ReturnType<typeof getExpenseSummary>> | null = null;
  const run = await runCoreWithExtras({ range: may.range, compareRange: may.compareRange, dims: EXPENSE_SUMMARY_DIMS, varyant: "paraBirimi",
    run: expenseSummaryRunner(may, undefined, (x) => { detail = x; }) });
  const cells = run.sunum.varyant?.hucreler ?? [];
  check("§7a ⭐ hücreler asıl para birimine göre, TL azalan: USD 300 · TRY 200", JSON.stringify(cells.map((c) => [c.deger, c.anaSayi.deger])) === JSON.stringify([["USD", 300], ["TRY", 200]]),
    JSON.stringify(cells.map((c) => [c.deger, c.anaSayi.deger])));
  check("§7b ⭐ Σ hücre = ana sayı = uç detayı (ana koşu)", run.sunum.anaSayi.deger === 500 && cells.reduce((t, c) => t + (c.anaSayi.deger ?? 0), 0) === 500
    && (detail as { totalTry: string } | null)?.totalTry === "500.00");
  const usdOnly = await getExpenseSummary({ range: may.range, currency: ["USD"] });
  check("§7c süzgeç: currency=USD yalnız döviz masrafı (TL karşılığı)", usdOnly.totalTry === "300.00" && usdOnly.categories.length === 1 && usdOnly.categories[0]!.label === "Kargo");
  check("§7d hücre adı günlük dilde, süzgeç anahtarı `currency`", run.sunum.varyant?.suzgecAnahtari === "currency" && cells[0]?.ad === "Amerikan Doları");
  check("§7e şema: bilinmeyen para birimi 400 · beyansız kırılım 400 · CSV kabul",
    !expenseSummaryQuerySchema.safeParse({ currency: "XYZ" }).success && !expenseSummaryQuerySchema.safeParse({ varyant: "musteri" }).success
      && !expenseSummaryQuerySchema.safeParse({ currency: "" }).success
      && expenseSummaryQuerySchema.safeParse({ currency: "USD,TRY", varyant: "paraBirimi", donemler: "ay:3" }).success);

  console.log("\n── §8 anlatı ──");
  const mayNarrative = run.sunum.anlati.map((a) => a.metin);
  check("§8a ⭐ en büyük pay cümlesi sunucuda: kategori + tutar + pay", mayNarrative.length === 1 && mayNarrative[0]!.includes("Kargo") && mayNarrative[0]!.includes("%60"),
    mayNarrative.join(" | "));
  const empty = await getExpenseSummary({ range: resolveCoreDayRange({ from: "2019-07-01", to: "2019-07-31", kiyas: "none" }, 90).range });
  check("§8b boş dönemde cümle yok", empty.categories.length === 0 && expenseSummaryNarrative(empty).length === 0);
  check("§8c eksi toplamlı kategori varken pay cümlesi kurulmaz (Nakliye −700)", s.categories.some((c) => Number(c.totalTry) < 0) && expenseSummaryNarrative(s).length === 0);

  console.log("\n── §6 kategori önerisi ayarı ──");
  const original = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_EXPENSE_CATEGORY_SUGGESTIONS } });
  try {
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_EXPENSE_CATEGORY_SUGGESTIONS } });
    const on = await expenseCategorySuggestions();
    check("§6a varsayılan (kayıt yok) ON: öneri döner, trim'li, tekil", on.enabled && on.categories.includes("Kira") && !on.categories.includes(" Kira ") && on.categories.length <= 20,
      on.categories.slice(0, 5).join(", "));
    await prisma.systemSetting.create({ data: { key: SETTING_KEYS.FINANCE_EXPENSE_CATEGORY_SUGGESTIONS, value: "OFF" } });
    const off = await expenseCategorySuggestions();
    check("§6b OFF: enabled:false, boş liste", !off.enabled && off.categories.length === 0);
  } finally {
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_EXPENSE_CATEGORY_SUGGESTIONS } });
    if (original) await prisma.systemSetting.create({ data: { key: original.key, value: original.value ?? "ON", description: original.description } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    try {
      await temizle();
    } catch (e) {
      console.error("TEMİZLİK HATASI:", e);
      fail++;
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect().catch(() => {});
    process.exitCode = fail > 0 ? 1 : 0;
  });
