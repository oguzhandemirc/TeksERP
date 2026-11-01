// =============================================================================
// BEKÇİ — KÂRLILIK: MASRAF BAĞI AS-OF (D4-G2c; DALGA4 §9.5 K19/K15, §13 D4-G2b "(H3 varsa)")
// =============================================================================
//   §0 AST — `profitability*.helper` içinde `expenseAllocation` delegesi / ham SQL / as-of dışı import, bağ dosyasında `revokedAt` yok ("aktif bağ" okuması
//      yasak); bağlar yalnız `profitability-finance` → `listExpenseAllocationsAsOf`ten gelir
//   §1 saf — %60 bağlı 1000 TL: hedef satıra 600 doğrudan, havuzda 400; iş emri hedefi adımdan çözülür; hedefsiz
//      ay "dağıtılmamış doğrudan"; parça yoksa satıra alan eklenmez
//   §2 DB — bağ alanı OFF ile bağsız OPTIONAL rapor BAYT-AYNI; %60 bağ → Ocak havuzu 600 eksik, doğrudan 600
//   §3 DB — Şubat'ta bağ %60 → %100: Ocak raporu BAYT-AYNI; Şubat'ta "geç bağ düzeltmesi" +400; (§3f iptal tersi yalnız iptal ayında) iptal edilen bağlı
//      masraf iptal ayında ters çevrilir; iki ayda havuz + doğrudan = bağsız havuz (toplam korunur)
//
// ⭐ NEGATİF SONDA: bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Ayarlar fotoğrafa döner; fikstür 2017 aylarındadır.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { Prisma, StationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { changeExpenseAllocation, createExpenseAllocation } from "../src/services/expense-allocation.service";
import { computeProfitability, type ProfitabilityResult } from "../src/services/helpers/profitability.helper";
import { attachDirectExpenses, deductFromPools, type DirectTargetRow } from "../src/services/helpers/profitability-allocation.helper";
import type { ExpenseAllocationPiece } from "../src/services/helpers/profitability-finance.helper";
import type { MonthPools } from "../src/services/helpers/profitability-overhead.helper";
import { factoryDayStartOfKey } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const HELPERS = path.resolve(__dirname, "../src/services/helpers");
const TAG = `TEST-KMB-${process.pid}`;
const AYARLAR = [
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.TICARET_ENABLED,
  SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_FIELD, SETTING_KEYS.COST_PROFIT_CATEGORY_CLASSES, SETTING_KEYS.COST_PROFIT_OVERHEAD_KEY,
];
const day = (ymd: string) => new Date(factoryDayStartOfKey(ymd).getTime() + 12 * 3_600_000);
const D = (v: number | string) => new Prisma.Decimal(v);
const ids = { boxes: [] as string[], machines: [] as string[], stations: [] as string[] };

// ── §0 AST ──
function bolum0(): void {
  const files = readdirSync(HELPERS).filter((f) => /^profitability.*\.helper\.ts$/.test(f));
  check("§0 zemin: kârlılık dosyaları ≥ 6 (bağ dosyası dahil)", files.length >= 6 && files.includes("profitability-allocation.helper.ts"), files.join(", "));
  const ihlal: string[] = [];
  for (const f of files) {
    const src = ts.createSourceFile(f, readFileSync(path.join(HELPERS, f), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && n.name.text === "expenseAllocation") ihlal.push(`${f}: .expenseAllocation`);
      if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "expenseAllocation") ihlal.push(`${f}: ["expenseAllocation"]`);
      // İlişki üzerinden okuma (`include/select: { expenseAllocations: … }`) da as-of okuyucuyu atlar.
      if ((ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === "expenseAllocations") ihlal.push(`${f}: expenseAllocations ilişkisi`);
      if ((ts.isTaggedTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) && /expense_allocations/.test(n.getText())) ihlal.push(`${f}: ham SQL expense_allocations`);
      // Bağ dosyası damga kolonuna hiç dokunmaz (geçerlilik yalnız as-of okuyucuda).
      if (f === "profitability-allocation.helper.ts" && (ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === "revokedAt") ihlal.push(`${f}: revokedAt`);
      // expense-allocation.helper'dan (statik ya da dinamik) yalnız as-of okuyucu alınır.
      if (ts.isImportDeclaration(n) && /expense-allocation\.helper/.test(n.moduleSpecifier.getText())) {
        const names = n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings) ? n.importClause.namedBindings.elements.map((e) => e.name.text) : ["*"];
        for (const x of names) if (x !== "listExpenseAllocationsAsOf") ihlal.push(`${f}: import ${x}`);
      }
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && /expense-allocation\.helper/.test(n.initializer.getText())) {
        for (const e of n.name.elements) if (e.name.getText() !== "listExpenseAllocationsAsOf") ihlal.push(`${f}: dinamik ${e.name.getText()}`);
      }
      if (ts.isVariableDeclaration(n) && !ts.isObjectBindingPattern(n.name) && n.initializer && /import\(\s*["'].*expense-allocation\.helper/.test(n.initializer.getText())) ihlal.push(`${f}: dinamik import (destructure edilmemiş)`);
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  check("§0a ⭐ kârlılıkta 'aktif bağ' okuması yok (expenseAllocation delegesi / ham SQL / bağ dosyasında revokedAt / as-of dışı import)", ihlal.length === 0, ihlal.join(", ") || "temiz");
  const fin = readFileSync(path.join(HELPERS, "profitability-finance.helper.ts"), "utf8");
  check("§0b bağlar yalnız as-of okuyucudan: profitability-finance `listExpenseAllocationsAsOf` çağırır", /listExpenseAllocationsAsOf\(prisma/.test(fin));
}

// ── §1 saf ──
function bolum1(): void {
  const piece = (o: Partial<ExpenseAllocationPiece>): ExpenseAllocationPiece => ({
    kind: "AS_OF", cashTransactionId: "c1", docNo: "M1", className: null, machineId: null, workOrderId: null, serviceItemId: null,
    sharePct: D(60), amountTry: D(600), ...o,
  });
  const row = (o: Partial<DirectTargetRow>): DirectTargetRow => ({ month: "2017-01", kind: "INVOICED", machineId: null, serviceItemId: "s1", workOrderStepId: null, meters: D(10), ...o });
  const pool: MonthPools = { month: "2017-01", overheadPoolTry: D(1000), laborPoolTry: D(0), excludedTry: D(0), categories: [] };
  const rows = [row({ machineId: "m1", meters: D(30) }), row({ machineId: "m1", meters: D(10) }), row({ machineId: "m2" }), row({ kind: "CANCELLED", machineId: "m1" })];
  const p60 = [piece({ machineId: "m1" })];
  deductFromPools(pool, p60, {});
  const d = attachDirectExpenses(rows, p60, {}, new Map());
  check("§1a ⭐ %60 bağlı 1000 TL: havuzda 400, hedefe 600 doğrudan", pool.overheadPoolTry.eq(400) && d.directTry.eq(600), `${pool.overheadPoolTry} / ${d.directTry}`);
  check("§1b hedef makinenin faturalanan satırlarına metreyle 450 + 150; başka makine ve iptal satırı almaz",
    rows[0]!.directExpenseTry?.eq(450) === true && rows[1]!.directExpenseTry?.eq(150) === true && rows[2]!.directExpenseTry === undefined && rows[3]!.directExpenseTry === undefined,
    rows.map((r) => String(r.directExpenseTry ?? "-")).join(","));
  const wRows = [row({ workOrderStepId: "st1" }), row({ workOrderStepId: "st2" })];
  attachDirectExpenses(wRows, [piece({ workOrderId: "w1", amountTry: D(100) })], {}, new Map([["st1", "w1"], ["st2", "w2"]]));
  check("§1c iş emri hedefi adım → iş emri eşlemesiyle çözülür", wRows[0]!.directExpenseTry?.eq(100) === true && wRows[1]!.directExpenseTry === undefined);
  const lone = attachDirectExpenses([row({})], [piece({ machineId: "yok", kind: "LATE_ADJUSTMENT", amountTry: D(-50) })], {}, new Map());
  check("§1d hedefin o ay satırı yoksa dağıtılmamış doğrudan; geç bağ ayrı toplamda", lone.undistributedTry.eq(-50) && lone.lateAdjustmentTry.eq(-50) && lone.directTry.isZero());
  const labor: MonthPools = { month: "2017-01", overheadPoolTry: D(0), laborPoolTry: D(300), excludedTry: D(50), categories: [] };
  deductFromPools(labor, [piece({ className: "Maaş", amountTry: D(100) }), piece({ className: "Vergi", amountTry: D(20) })], { Maaş: "ISCILIK", Vergi: "HARIC" });
  check("§1e parça kendi sınıfının havuzundan düşer (işçilik 200, hariç 30)", labor.laborPoolTry.eq(200) && labor.excludedTry.eq(30), `${labor.laborPoolTry} ${labor.excludedTry}`);
}

const jsonOf = (r: ProfitabilityResult | null) => JSON.stringify(r);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(engel); process.exitCode = 1; return; }
  bolum0();
  bolum1();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const setSetting = (key: string, v: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  const bagAlani = async (v: "OFF" | "OPTIONAL") => { await setSetting(SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_FIELD, v); invalidateFeatureFlagsCache(); };
  try {
    for (const k of AYARLAR.slice(0, 4)) await setSetting(k, true);
    await prisma.systemSetting.deleteMany({ where: { key: { in: AYARLAR.slice(5) } } });
    await bagAlani("OFF");
    const uid = (await ensureTestAdmin()).id;
    const st = await prisma.station.create({ data: { code: `KMB-ST-${process.pid}`, name: `${TAG} istasyon`, type: StationType.INTERNAL }, select: { id: true } });
    ids.stations.push(st.id);
    const m = await prisma.machine.create({ data: { stationId: st.id, code: `KMB${process.pid % 100000}`, name: `${TAG} makine` }, select: { id: true } });
    ids.machines.push(m.id);
    const box = await prisma.cashBox.create({ data: { code: `${TAG}-K`, name: `${TAG} kasa`, currency: "TRY" }, select: { id: true } });
    ids.boxes.push(box.id);
    await cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 100000, txnDate: day("2016-12-01") });
    const masraf = async (amount: number, ymd: string) =>
      (await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box.id, amount, txnDate: day(ymd), category: `${TAG} kira` })).data!.id;
    const e1 = await masraf(1000, "2017-01-10");
    const e2 = await masraf(500, "2017-01-12");
    const jan = () => computeProfitability({ fromMonth: "2017-01", toMonth: "2017-01" });
    const both = () => computeProfitability({ fromMonth: "2017-01", toMonth: "2017-02" });

    // ── §2 ──
    const offJan = jsonOf(await jan());
    const offBoth = (await both())!;
    await bagAlani("OPTIONAL");
    check("§2a ⭐ bağsız: bağ alanı OFF ile OPTIONAL rapor BAYT-AYNI (alan eklenmez)", jsonOf(await jan()) === offJan);
    const b1 = await createExpenseAllocation(e1, { machineId: m.id, sharePct: "60", clientToken: randomUUID() }, uid);
    const b2 = await createExpenseAllocation(e2, { machineId: m.id, sharePct: "100", clientToken: randomUUID() }, uid);
    await prisma.expenseAllocation.updateMany({ where: { id: { in: [b1.data!.id, b2.data!.id] } }, data: { createdAt: day("2017-01-15") } });
    const j1 = (await jan())!;
    const jm = j1.months[0]!;
    const mine = (jm.directExpenses?.lines ?? []).filter((l) => l.cashTransactionId === e1);
    check("§2b ⭐ %60 bağ: Ocak'ta hedefe 600 doğrudan (AS_OF), havuz bağsıza göre 600 + 500 eksik",
      mine.length === 1 && mine[0]!.amountTry.eq(600) && mine[0]!.machineId === m.id && JSON.parse(offJan).months[0].overheadPoolTry - Number(jm.overheadPoolTry) === 1100,
      `${mine.map((l) => `${l.kind}:${l.amountTry}`).join(",")} havuz=${jm.overheadPoolTry}`);
    check("§2c hedefin faturalanan işi yok → dağıtılmamış doğrudan 1100 (raporda uyarı)", jm.directExpenses?.undistributedTry.eq(1100) === true, String(jm.directExpenses?.undistributedTry));
    const janBefore = jsonOf(j1);

    // ── §3 Şubat: bağ değişimi + iptal ──
    const b3 = await changeExpenseAllocation(b1.data!.id, { machineId: m.id, sharePct: "100", clientToken: randomUUID() }, uid);
    await prisma.expenseAllocation.update({ where: { id: b1.data!.id }, data: { revokedAt: day("2017-02-10") } });
    await prisma.expenseAllocation.update({ where: { id: b3.data!.id }, data: { createdAt: day("2017-02-10") } });
    await cashTransactionService.cancel(e2, "test iptal", uid);
    await prisma.cashTransaction.update({ where: { id: e2 }, data: { cancelledAt: day("2017-02-20") } });
    check("§3a ⭐ geçen ayın (Ocak) raporu bağ değişimi ve iptalden sonra BAYT-AYNI", jsonOf(await jan()) === janBefore);
    const r = (await both())!;
    const feb = r.months[1]!;
    check("§3b ⭐ Şubat'ta geç bağ düzeltmesi +400 (−600 damga, +1000 yeni bağ)", feb.directExpenses?.lateAdjustmentTry.eq(400) === true,
      (feb.directExpenses?.lines ?? []).map((l) => `${l.kind}:${l.amountTry}`).join(","));
    check("§3c iptal edilen bağlı masraf iptal ayında ters çevrilir (−500)", feb.directExpenses?.cancelReversalTry.eq(-500) === true, String(feb.directExpenses?.cancelReversalTry));
    const offSum = offBoth.months.reduce((a, x) => a.plus(x.overheadPoolTry), D(0)).minus(500); // bağsız havuz + Şubat iptal eksisi
    const onSum = r.months.reduce((a, x) => a.plus(x.overheadPoolTry).plus(x.directExpenses?.directTry ?? 0).plus(x.directExpenses?.lateAdjustmentTry ?? 0).plus(x.directExpenses?.cancelReversalTry ?? 0), D(0));
    check("§3d ⭐ iki ay toplamı korunur: havuz + doğrudan = bağsız havuz", onSum.eq(offSum), `${onSum} / ${offSum}`);
    const directTotal = r.months.reduce((a, x) => a.plus(x.directExpenses?.directTry ?? 0).plus(x.directExpenses?.lateAdjustmentTry ?? 0).plus(x.directExpenses?.cancelReversalTry ?? 0), D(0));
    check("§3e iki ay doğrudan toplamı = son bağ durumu (e1 %100 = 1000; iptal e2 = 0)", directTotal.eq(1000), String(directTotal));
    const mar = (await computeProfitability({ fromMonth: "2017-03", toMonth: "2017-03" }))!.months[0]!;
    check("§3f iptal ters kaydı YALNIZ iptal ayında: Mart'ta CANCEL_REVERSAL yok", !(mar.directExpenses?.cancelReversalTry ?? D(0)).abs().gt(0), String(mar.directExpenses?.cancelReversalTry));
  } finally {
    if (ids.boxes.length) {
      await prisma.expenseAllocation.deleteMany({ where: { cashTransaction: { cashBoxId: { in: ids.boxes } } } });
      await prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: ids.boxes } } });
      await prisma.cashBox.deleteMany({ where: { id: { in: ids.boxes } } });
    }
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
    for (const k of AYARLAR) {
      const f = foto.find((x) => x.key === k);
      if (f) await setSetting(k, f.value as Prisma.InputJsonValue);
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    invalidateFeatureFlagsCache();
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
