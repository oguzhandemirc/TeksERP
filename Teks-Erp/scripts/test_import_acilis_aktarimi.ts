// TOPLU AÇILIŞ AKTARIMI (GERÇEK DB): cari açılış bakiyesi · çek/senet portföyü · hizmet fiyat listesi
// içe aktarım adaptörleri. Her biri: geçerli/hatalı satır, önizleme = uygulama, replay (clientToken),
// tekil yolla AYNI defter satırı (iki yol bayt-eşit), ters kayıtla geri sarma (silinmez).
import prisma, { pool } from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import { ImportRevertService, REVERT_PLAN } from "../src/services/import/import-revert.service";
import { getImportAdapter, listAdapters } from "../src/services/import/import-registry";
import { cariService } from "../src/services/cari.service";
import { chequeService } from "../src/services/cheque.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { parseDateCell } from "../src/services/import/import-coerce";
import { systemSettingService, readFinanceEnabledRaw, readTicaretEnabledRaw } from "../src/services/system-setting.service";
import type { ImportApplyResult, ImportRowInput } from "../src/services/import/import.types";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TEST-ACL-${Date.now()}`;
const ALL = ["*"];
const runs: string[] = [];
const customers: string[] = [];
const items: string[] = [];
const row = (rowNo: number, cells: Record<string, string>): ImportRowInput => ({ rowNo, cells });
let adminId = "";

async function apply(entity: string, rows: ImportRowInput[], clientToken?: string): Promise<ImportApplyResult> {
  const r = await ImportService.apply(entity, rows, { clientToken }, { userId: adminId, permissions: ALL });
  if (!runs.includes(r.runId)) runs.push(r.runId);
  return r;
}
async function customer(s: string): Promise<{ id: string; code: string }> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${s}`, name: `${TAG} MÜŞTERİ ${s}` }, select: { id: true, code: true } });
  customers.push(c.id);
  return c;
}
/** Defter satırının kimlik dışı alanları — iki yolun bayt-eşitliği bununla ölçülür. */
async function ledgerShape(where: { cariId: string } | { chequeId: string }): Promise<string> {
  const rows = await prisma.cariTransaction.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { currency: true, txnDate: true, debit: true, credit: true, amountTry: true, exchangeRate: true, sourceType: true, createdById: true },
  });
  return JSON.stringify(rows);
}

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) throw new Error(block);
  adminId = (await ensureTestAdmin()).id;
  const before = { financeEnabled: await readFinanceEnabledRaw(), ticaretEnabled: await readTicaretEnabledRaw() };
  try {
    console.log("§0 statik: kayıt defteri + modül kapısı + ters yol");
    const gated = listAdapters().filter((a) => ["finans", "ticaret"].includes(a.module ?? "")).map((a) => `${a.entity}:${a.module}`).sort().join(",");
    check("§0a üç adaptör modül kapılı", gated === "cariOpeningBalance:finans,chequePortfolio:finans,customerServicePrice:ticaret", gated);
    check("§0b ters yol: devir/çek TERS KAYIT, fiyat damgalı sürüm",
      REVERT_PLAN.cariOpeningBalance?.mode === "REVERSE_ENTRY" && REVERT_PLAN.chequePortfolio?.mode === "REVERSE_ENTRY" && REVERT_PLAN.customerServicePrice?.mode === "REVOKE_VERSION");
    check("§0c fiyat audit yüküne girmez", (getImportAdapter("customerServicePrice").auditOmit ?? []).includes("price"));
    await systemSettingService.setFeatureFlags({ financeEnabled: false, ticaretEnabled: false }, adminId);
    const closed = (await ImportService.listEntities(ALL)).map((e) => e.entity);
    check("§0d modüller kapalıyken üç tür listede YOK (sıfır fark)", !closed.includes("cariOpeningBalance") && !closed.includes("chequePortfolio") && !closed.includes("customerServicePrice"));
    await systemSettingService.setFeatureFlags({ financeEnabled: true }, adminId);
    await systemSettingService.setFeatureFlags({ ticaretEnabled: true }, adminId);

    // ── §1 CARİ AÇILIŞ ──────────────────────────────────────────────────────────
    console.log("§1 cari açılış bakiyesi");
    const a = await customer("A");
    const b = await customer("B");
    const fason = await ensureTestDyeHouse();
    const date = "15.01.2026";
    const ob = (n: number, c: Record<string, string>) => row(n, { cariType: "Müşteri", currency: "TRY", direction: "Borçlu", txnDate: date, ...c });
    const bad = await ImportService.preview("cariOpeningBalance", [
      ob(2, { cariCode: a.code, amount: "1000" }),
      ob(3, { cariCode: a.code, amount: "5" }),
      ob(4, { cariCode: `${TAG}-YOK`, amount: "10" }),
      ob(5, { cariCode: b.code, amount: "0" }),
      ob(6, { cariCode: b.code, currency: "USD", amount: "10", direction: "Yanlış" }),
    ], {}, { userId: adminId, permissions: ALL });
    const act = bad.rows.map((r) => r.action).join(",");
    check("§1a geçerli satır CREATE; dosya-içi çift · bilinmeyen cari · sıfır tutar · bozuk yön HATA", act === "CREATE,ERROR,ERROR,ERROR,ERROR", act);
    const okRows = [
      ob(2, { cariCode: a.code, amount: "1234,56", description: "Devir" }),
      ob(3, { cariCode: a.code, currency: "USD", amount: "200", direction: "Alacaklı", description: "Devir" }),
      ob(4, { cariType: "Fason", cariCode: fason.code, currency: "RUB", amount: "77", description: "Devir" }),
    ];
    const pv = await ImportService.preview("cariOpeningBalance", okRows, {}, { userId: adminId, permissions: ALL });
    const token = crypto.randomUUID();
    const ap = await apply("cariOpeningBalance", okRows, token);
    check("§1b önizleme = uygulama (3 CREATE)", pv.summary.create === 3 && ap.created === 3 && ap.status === "APPLIED", `${pv.summary.create}/${ap.created}/${ap.status}`);
    const rp = await apply("cariOpeningBalance", okRows, token);
    const accA = (await prisma.cariAccount.findFirst({ where: { customerId: a.id }, select: { id: true } }))!.id;
    const nA = await prisma.cariTransaction.count({ where: { cariId: accA } });
    check("§1c replay aynı token: yeni satır YOK, aynı koşum", rp.runId === ap.runId && nA === 2, `${nA} satır`);
    const dup = await ImportService.preview("cariOpeningBalance", [okRows[0]!], {}, { userId: adminId, permissions: ALL });
    check("§1d ikinci açılış (aynı cari + döviz) satır HATASI", dup.rows[0]?.action === "ERROR" && /zaten girilmiş/.test(dup.rows[0]?.errors[0]?.message ?? ""), dup.rows[0]?.errors[0]?.message);
    // İki yol bayt-eşit: B carisine tekil servis yoluyla AYNI değerler.
    const accB = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: b.id, subcontractorId: null }));
    await cariService.setOpeningBalance({ cariId: accB.id, currency: "TRY", balance: "1234.56", description: "Devir", txnDate: parseDateCell(date)! }, adminId);
    await cariService.setOpeningBalance({ cariId: accB.id, currency: "USD", balance: "-200", description: "Devir", txnDate: parseDateCell(date)! }, adminId);
    const shapeA = await ledgerShape({ cariId: accA });
    const shapeB = await ledgerShape({ cariId: accB.id });
    check("§1e içe aktarım = tekil uç (defter satırları bayt-eşit)", shapeA === shapeB, shapeA === shapeB ? "" : `${shapeA} ≠ ${shapeB}`);
    const balA = await prisma.cariBalance.findMany({ where: { cariId: accA }, orderBy: { currency: "asc" }, select: { currency: true, balance: true } });
    const balB = await prisma.cariBalance.findMany({ where: { cariId: accB.id }, orderBy: { currency: "asc" }, select: { currency: true, balance: true } });
    check("§1f bakiyeler eşit (TRY +1234.56 · USD −200)", JSON.stringify(balA) === JSON.stringify(balB) && balA.length === 2, JSON.stringify(balA));
    const plan = await ImportRevertService.preview(ap.runId, ALL);
    check("§1g geri sarma planı TERS KAYIT", plan.rows.every((r) => r.action === "REVERSE_ENTRY" && !r.skipReason), plan.rows.map((r) => `${r.action}:${r.skipReason ?? ""}`).join(","));
    const rv = await ImportRevertService.revert(ap.runId, { reason: "Açılış bekçi geri sarma", selectedRowNos: [2, 3, 4], permissions: ALL, userId: adminId });
    const afterRows = await prisma.cariTransaction.findMany({ where: { cariId: accA }, select: { sourceType: true } });
    check("§1h geri sarma: ileri satır SİLİNMEDİ + ters kayıt yazıldı",
      rv.reverted === 3 && afterRows.length === 4 && afterRows.filter((r) => r.sourceType === "ADJUSTMENT_CANCEL").length === 2, `${rv.reverted} · ${afterRows.length}`);
    const again = await ImportService.preview("cariOpeningBalance", [okRows[0]!], {}, { userId: adminId, permissions: ALL });
    check("§1i iptal sonrası yeni devir girilebilir (CREATE)", again.rows[0]?.action === "CREATE");
    const plan2 = await ImportRevertService.preview(ap.runId, ALL);
    check("§1j ikinci geri sarma planında satırlar atlanır", plan2.rows.every((r) => r.alreadyReverted));

    // ── §2 ÇEK/SENET ────────────────────────────────────────────────────────────
    console.log("§2 çek/senet portföyü");
    const c = await customer("C");
    const d = await customer("D");
    const ch = (n: number, x: Record<string, string>) => row(n, { kind: "Alınan", cariType: "Müşteri", amount: "5000", currency: "TRY", dueDate: "15.03.2027", bankName: "Ziraat", drawerName: "Keşideci A", ...x });
    // "Kur yok" koşulunu bekçi KENDİ kurar: çözümleyici o tarihe kadarki EN SON kuru alır ve CI'daki arka plan
    // sunucusunun TCMB turu bugüne yakın GBP kuru yazabilir → işlem tarihi kimsenin kur yazmadığı eski bir gün.
    const noRateDay = "02.01.1985";
    const gbpUpTo = await prisma.exchangeRate.count({ where: { currency: "GBP", rateDate: { lte: parseDateCell(noRateDay)! } } });
    check("§2a0 ön koşul: işlem gününe kadar GBP kuru yok", gbpUpTo === 0, `${gbpUpTo} satır`);
    const chBad = await ImportService.preview("chequePortfolio", [
      ch(2, { cariCode: c.code, serialNo: "S-1" }),
      ch(3, { cariCode: c.code, serialNo: "s-1" }),
      ch(4, { cariCode: c.code, serialNo: "S-2", dueDate: "" }),
      ch(5, { cariCode: c.code, serialNo: "S-3", currency: "GBP", exchangeRate: "", postingDate: noRateDay }),
    ], {}, { userId: adminId, permissions: ALL });
    const chAct = chBad.rows.map((r) => r.action).join(",");
    const noRateCols = (chBad.rows[3]?.errors ?? []).map((e) => e.column).join(",");
    check("§2a geçerli CREATE; çift seri · vadesiz · kursuz döviz HATA (kur sütunu)",
      chAct === "CREATE,ERROR,ERROR,ERROR" && noRateCols === "exchangeRate", `${chAct} · ${noRateCols}`);
    const chOk = [ch(2, { cariCode: c.code, serialNo: "S-1" }), ch(3, { cariCode: c.code, serialNo: "S-9", docType: "Senet", kind: "Verilen", amount: "750" })];
    const chPv = await ImportService.preview("chequePortfolio", chOk, {}, { userId: adminId, permissions: ALL });
    const chTok = crypto.randomUUID();
    const chAp = await apply("chequePortfolio", chOk, chTok);
    check("§2b önizleme = uygulama (2 CREATE)", chPv.summary.create === 2 && chAp.created === 2, `${chPv.summary.create}/${chAp.created}`);
    await apply("chequePortfolio", chOk, chTok);
    const accC = (await prisma.cariAccount.findFirst({ where: { customerId: c.id }, select: { id: true } }))!.id;
    check("§2c replay: çek sayısı 2", (await prisma.cheque.count({ where: { cariId: accC } })) === 2);
    const chDup = await ImportService.preview("chequePortfolio", [chOk[0]!], {}, { userId: adminId, permissions: ALL });
    check("§2d aynı seri no ikinci kez satır HATASI", chDup.rows[0]?.action === "ERROR");
    const viaImport = await prisma.cheque.findFirst({ where: { cariId: accC, serialNo: "S-1" }, select: { id: true, status: true, amount: true, dueDate: true, bankName: true, drawerName: true } });
    const single = await chequeService.create({ kind: "RECEIVED", customerId: d.id, currency: "TRY", amount: "5000", dueDate: parseDateCell("15.03.2027")!, serialNo: "S-1", bankName: "Ziraat", drawerName: "Keşideci A" }, adminId);
    const viaSingle = await prisma.cheque.findUnique({ where: { id: single.data!.id }, select: { id: true, status: true, amount: true, dueDate: true, bankName: true, drawerName: true } });
    const strip = (x: Record<string, unknown> | null) => JSON.stringify({ ...x, id: undefined });
    const ledgerI = (await ledgerShape({ chequeId: viaImport!.id })).replace(/"txnDate":"[^"]+"/g, "");
    const ledgerS = (await ledgerShape({ chequeId: viaSingle!.id })).replace(/"txnDate":"[^"]+"/g, "");
    check("§2e içe aktarım = tekil uç (çek + defter satırı)", strip(viaImport) === strip(viaSingle) && ledgerI === ledgerS && viaImport?.status === "PORTFOLIO", `${ledgerI} | ${ledgerS}`);
    const chRv = await ImportRevertService.revert(chAp.runId, { reason: "Çek bekçi geri sarma", selectedRowNos: [2, 3], permissions: ALL, userId: adminId });
    const st = await prisma.cheque.findMany({ where: { cariId: accC }, select: { status: true } });
    const cancels = await prisma.cariTransaction.count({ where: { cariId: accC, sourceType: "CHEQUE_CANCEL" } });
    check("§2f geri sarma: çekler İPTAL, ters kayıt yazıldı, silinmedi", chRv.reverted === 2 && st.length === 2 && st.every((s) => s.status === "CANCELLED") && cancels === 2, `${chRv.reverted}/${cancels}`);

    // ── §3 HİZMET FİYATI ────────────────────────────────────────────────────────
    console.log("§3 hizmet fiyat listesi");
    const e = await customer("E");
    const svc = await prisma.item.create({ data: { code: `${TAG}-HZM`, name: `${TAG} HİZMET`, itemType: "SERVICE", unit: "MT" }, select: { id: true, code: true } });
    const fab = await prisma.item.create({ data: { code: `${TAG}-KMS`, name: `${TAG} KUMAŞ`, itemType: "FABRIC", unit: "MT" }, select: { id: true, code: true } });
    items.push(svc.id, fab.id);
    const sp = (n: number, x: Record<string, string>) => row(n, { customerCode: e.code, itemCode: svc.code, price: "3,75", currency: "USD", ...x });
    const spBad = await ImportService.preview("customerServicePrice", [
      sp(2, {}),
      sp(3, { itemCode: fab.code }),
      sp(4, { currency: "EUR", unit: "Kg" }),
      sp(5, { price: "9" }),
    ], {}, { userId: adminId, permissions: ALL });
    const spAct = spBad.rows.map((r) => r.action).join(",");
    check("§3a geçerli CREATE; servis olmayan kalem · birim uyuşmazlığı · dosya-içi çift HATA", spAct === "CREATE,ERROR,ERROR,ERROR", spAct);
    const spTok = crypto.randomUUID();
    const sp1 = await apply("customerServicePrice", [sp(2, {})], spTok);
    await apply("customerServicePrice", [sp(2, {})], spTok);
    check("§3b uygula + replay: tek aktif fiyat", sp1.created === 1 && (await prisma.itemPrice.count({ where: { itemId: svc.id, customerId: e.id } })) === 1);
    const same = await ImportService.preview("customerServicePrice", [sp(2, {})], {}, { userId: adminId, permissions: ALL });
    check("§3c aynı fiyat SKIP", same.rows[0]?.action === "SKIP", same.rows[0]?.action);
    const upd = await apply("customerServicePrice", [sp(2, { price: "4,10" })]);
    const prices = await prisma.itemPrice.findMany({ where: { itemId: svc.id, customerId: e.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { price: true, revokedAt: true } });
    check("§3d farklı fiyat UPDATE: eski sürüm damgalı, yenisi aktif", upd.updated === 1 && prices.length === 2 && prices[0]!.revokedAt !== null && prices[1]!.price.toString() === "4.1", JSON.stringify(prices));
    const logs = await prisma.systemLog.findMany({ where: { tableName: "ITEM_PRICE", newData: { path: ["importRunId"], equals: upd.runId } }, select: { newData: true } });
    check("§3e içe aktarım audit satırında (importRunId) fiyat YOK — servis audit'i tekil uçla aynı, kapsam dışı", logs.length === 1 && !("price" in ((logs[0]?.newData as Record<string, unknown>) ?? {})), JSON.stringify(logs[0]?.newData));
    await ImportRevertService.revert(upd.runId, { reason: "Fiyat bekçi geri sarma", selectedRowNos: [2], permissions: ALL, userId: adminId });
    const active = await prisma.itemPrice.findFirst({ where: { itemId: svc.id, customerId: e.id, revokedAt: null }, select: { price: true } });
    check("§3f geri sarma önceki fiyatı yeni sürüm olarak yazar (3.75)", active?.price.toString() === "3.75", active?.price.toString());

    console.log("§4 kapalı modül");
    await systemSettingService.setFeatureFlags({ ticaretEnabled: false }, adminId);
    check("§4a ticaret kapalı: hizmet fiyatı listede yok", !(await ImportService.listEntities(ALL)).some((x) => x.entity === "customerServicePrice"));
  } finally {
    await systemSettingService.setFeatureFlags({ ticaretEnabled: before.ticaretEnabled }, adminId);
    await systemSettingService.setFeatureFlags({ financeEnabled: before.financeEnabled }, adminId);
    await cleanup();
  }
}

async function cleanup(): Promise<void> {
  // Fason fixture kalıcı: yalnız bu bekçinin içe aktarımının yazdığı devir satırları (run satırlarının recordId'si) + tersleri silinir.
  const runTxnIds = (await prisma.importRunLine.findMany({ where: { importRunId: { in: runs } }, select: { recordId: true } }))
    .map((x) => x.recordId)
    .filter((x): x is string => typeof x === "string");
  if (runs.length > 0) {
    await prisma.importRunLine.deleteMany({ where: { importRunId: { in: runs } } });
    await prisma.importRun.deleteMany({ where: { id: { in: runs } } });
  }
  const accs = (await prisma.cariAccount.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((x) => x.id);
  const cheques = (await prisma.cheque.findMany({ where: { cariId: { in: accs } }, select: { id: true } })).map((x) => x.id);
  await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: cheques } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accs }, reversesTxnId: { not: null } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accs } } });
  await prisma.cariTransaction.deleteMany({ where: { reversesTxnId: { in: runTxnIds } } });
  await prisma.cariTransaction.deleteMany({ where: { id: { in: runTxnIds } } });
  await prisma.cheque.deleteMany({ where: { id: { in: cheques } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accs } } });
  // Fason fixture kalıcıdır: RUB bakiyesi yalnız bu bekçinin hareketiydi (yaz/ters = 0) — satır kalabilir, sıfırdır.
  await prisma.cariAccount.deleteMany({ where: { id: { in: accs } } });
  await prisma.itemPrice.deleteMany({ where: { itemId: { in: items } } });
  await prisma.item.deleteMany({ where: { id: { in: items } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
