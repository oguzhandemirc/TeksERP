// =============================================================================
// Test: Rapor servisleri (src/services/reports/*) — happy-path, kendi fixture'ı
// Çalıştır: npx tsx scripts/test_reports.ts
// =============================================================================
// Her rapor için KENDİ TEST- verisini yaratır, rapor metodunu çağırır ve dönen
// satırı/toplamı KENDİ verisine göre doğrular (global toplamlara güvenmez —
// eşzamanlı testler/seed verisi olabilir). Kapsanan domainler:
//   sales      → getOrderFulfillment, getLateDeliveries
//   customer   → getCustomerOrderProfiles, getAliasStats
//   inventory  → getStockDistribution
//   audit      → getSystemLogSummary, getUserActivity
//   quality    → getStationDefectRate + getDefectDistribution + getQc2Decisions
//   production → getScrapSummary (CUT hata kırılımı / SCRAP rulo özeti)
//
// production/subcontract'in geri kalan istasyon-tabanlı raporları (RollMovement/
// RollOperation throughput'u gerektirenler) BİLİNÇLİ atlandı — ağır fixture.
//
// NOT (düzeltilmiş bug): getDefectDistribution/getQc2Decisions/getScrapSummary
// önceden re."actionTaken"'ı eski enum literalleriyle ('CUT_FOR_SCRAP','KEPT_AS_A1',
// 'NO_ACTION') karşılaştırıyordu; gerçek RollErrorAction enum'u CUT|NO_CUT → her
// çağrıda 22P02 (500). Bu turda düzeltildi (CUT/NO_CUT eşlemesi + COALESCE ::text).
// Bu test artık o üç raporu happy-path olarak doğrular (regresyon koruması).
// =============================================================================
import prisma from "../src/lib/prisma";
import type { DateRange } from "../src/services/reports/_shared";
import { getOrderFulfillment, getLateDeliveries } from "../src/services/reports/sales.report.service";
import { getCustomerOrderProfiles, getAliasStats } from "../src/services/reports/customer.report.service";
import { getStockDistribution } from "../src/services/reports/inventory.report.service";
import { getSystemLogSummary, getUserActivity } from "../src/services/reports/audit.report.service";
import {
  getStationDefectRate,
  getDefectDistribution,
  getQc2Decisions,
} from "../src/services/reports/quality.report.service";
import { getScrapSummary, getOperatorPerformance } from "../src/services/reports/production.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const round1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const ts = Date.now();
  // Dar tarih aralığı: yalnız bizim fixture'ın etiketlendiği zaman penceresi.
  // detectedAt/processedAt/createdAt'i bu aralığın ortasına (ANCHOR) sabitleyip
  // diğer testlerin/seed verisinin sızmasını minimize ediyoruz.
  const ANCHOR = new Date("2099-01-15T12:00:00.000Z"); // gelecekte → seed/komşu test yok
  const range: DateRange = {
    from: new Date("2099-01-01T00:00:00.000Z"),
    to: new Date("2099-01-31T23:59:59.999Z"),
  };

  // Seed master-data (business-key ile çöz; hardcoded UUID yok)
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const defect = await prisma.defectType.findFirst({ select: { id: true, name: true } });
  const user = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true, username: true } });
  if (!item) throw new Error("Seed item yok (npm run seed)");
  if (!color) throw new Error("Seed color yok (npm run seed)");
  if (!defect) throw new Error("Seed defectType yok (npm run seed)");
  if (!user) throw new Error("admin kullanıcısı yok (npm run seed)");

  // Yaratılan kayıt id'leri (cleanup için)
  let customerId = "";
  let orderFulfillId = "";
  let orderLateId = "";
  const orderLineIds: string[] = [];
  let aliasItemId = "";
  let aliasColorId = "";
  let stockRollId = "";
  let defectRollId = "";
  let workOrderId = "";
  let workOrderStepId = "";
  let rollOperationId = "";
  const rollErrorIds: string[] = [];
  const systemLogIds: string[] = [];

  try {
    // -----------------------------------------------------------------------
    // FIXTURE: TEST müşteri + 2 sipariş (fulfillment + late) + sipariş satırları
    // -----------------------------------------------------------------------
    const customer = await prisma.customer.create({
      data: { code: `TEST-RPT-${ts}`, name: `TEST RAPOR MUSTERI ${ts}`, type: "CUSTOMER", isActive: true },
      select: { id: true, name: true, code: true },
    });
    customerId = customer.id;

    // Fulfillment siparişi: planned=300 (120+180), shipped=120 → %40 gerçekleşme
    const PLANNED_A = 120;
    const PLANNED_B = 180;
    const SHIPPED = 120;
    const orderF = await prisma.order.create({
      data: {
        orderNumber: `TEST-RPT-OF-${ts}`,
        customerId: customer.id,
        status: "PARTIAL_SHIPPED",
        orderDate: ANCHOR,
        createdAt: ANCHOR,
        shippedQty: SHIPPED,
        lines: {
          create: [
            { itemId: item.id, colorId: color.id, quantity: PLANNED_A, width: 150 },
            { itemId: item.id, colorId: color.id, quantity: PLANNED_B, width: 150 },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderFulfillId = orderF.id;
    orderF.lines.forEach((l) => orderLineIds.push(l.id));

    // -----------------------------------------------------------------------
    // 1) SALES — getOrderFulfillment: byStatus + worstFulfillment kendi siparişimiz
    // -----------------------------------------------------------------------
    const ful = await getOrderFulfillment(range);
    const partialRow = ful.byStatus.find((r) => r.status === "PARTIAL_SHIPPED");
    check(
      "fulfillment byStatus[PARTIAL_SHIPPED] kendi planned/shipped'i yansıtıyor",
      !!partialRow &&
        partialRow.count === 1 &&
        partialRow.plannedQty === round1(PLANNED_A + PLANNED_B) &&
        partialRow.shippedQty === round1(SHIPPED),
      partialRow ? `count=${partialRow.count} planned=${partialRow.plannedQty} shipped=${partialRow.shippedQty}` : "satır yok",
    );
    const worst = ful.worstFulfillment.find((w) => w.orderId === orderFulfillId);
    const expectedPct = round1((SHIPPED / (PLANNED_A + PLANNED_B)) * 100); // 40.0
    check(
      "fulfillment worst listesinde sipariş doğru yüzdeyle var",
      !!worst && worst.fulfillmentPct === expectedPct && worst.plannedQty === round1(PLANNED_A + PLANNED_B),
      worst ? `pct=${worst.fulfillmentPct} (beklenen ${expectedPct})` : "sipariş worst listesinde yok",
    );
    check(
      "fulfillment toplamları kendi satırlarımızı içeriyor (>=)",
      ful.totalOrders >= 1 && ful.totalPlannedQty >= PLANNED_A + PLANNED_B,
      `totalOrders=${ful.totalOrders} totalPlanned=${ful.totalPlannedQty}`,
    );

    // -----------------------------------------------------------------------
    // 2) SALES — getLateDeliveries: deadline geçmiş açık sipariş (snapshot)
    // -----------------------------------------------------------------------
    const LATE_PLANNED = 50;
    const LATE_SHIPPED = 10;
    const pastDeadline = new Date(Date.now() - 5 * 86_400_000); // 5 gün önce
    const orderL = await prisma.order.create({
      data: {
        orderNumber: `TEST-RPT-LATE-${ts}`,
        customerId: customer.id,
        status: "APPROVED",
        orderDate: pastDeadline,
        deadline: pastDeadline,
        shippedQty: LATE_SHIPPED,
        lines: { create: [{ itemId: item.id, colorId: color.id, quantity: LATE_PLANNED, width: 150 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderLateId = orderL.id;
    orderL.lines.forEach((l) => orderLineIds.push(l.id));

    const late = await getLateDeliveries();
    const lateRow = late.find((r) => r.orderId === orderLateId);
    check(
      "lateDeliveries kendi geç siparişimizi remainingQty/daysLate ile döner",
      !!lateRow &&
        lateRow.plannedQty === round1(LATE_PLANNED) &&
        lateRow.shippedQty === round1(LATE_SHIPPED) &&
        lateRow.remainingQty === round1(LATE_PLANNED - LATE_SHIPPED) &&
        lateRow.daysLate >= 4,
      lateRow ? `remaining=${lateRow.remainingQty} daysLate=${lateRow.daysLate}` : "geç sipariş listede yok",
    );

    // -----------------------------------------------------------------------
    // 3) CUSTOMER — getCustomerOrderProfiles: müşteri agg + favori ürün/renk
    // -----------------------------------------------------------------------
    const profiles = await getCustomerOrderProfiles();
    const myProfile = profiles.find((p) => p.customerId === customerId);
    // 2 sipariş (fulfillment + late), 3 satır (2 + 1)
    check(
      "customerProfile kendi müşterimizi doğru order/line sayısıyla döner",
      !!myProfile &&
        myProfile.orderCount === 2 &&
        myProfile.lineCount === 3 &&
        myProfile.topItemName === item.name &&
        myProfile.topColorName === color.name,
      myProfile
        ? `orders=${myProfile.orderCount} lines=${myProfile.lineCount} topItem=${myProfile.topItemName}`
        : "müşteri profili yok",
    );

    // -----------------------------------------------------------------------
    // 4) CUSTOMER — getAliasStats: bizim müşteriye 1 item + 1 color alias ekle
    // -----------------------------------------------------------------------
    const beforeAlias = await getAliasStats();
    const ia = await prisma.customerItemAlias.create({
      data: { customerId, itemId: item.id, alias: `TEST-ALIAS-ITEM-${ts}` },
      select: { id: true },
    });
    aliasItemId = ia.id;
    const ca = await prisma.customerColorAlias.create({
      data: { customerId, colorId: color.id, alias: `TEST-ALIAS-COLOR-${ts}` },
      select: { id: true },
    });
    aliasColorId = ca.id;

    const afterAlias = await getAliasStats();
    check(
      "aliasStats toplamları yarattığımız 1+1 alias kadar arttı",
      afterAlias.totalItemAliases === beforeAlias.totalItemAliases + 1 &&
        afterAlias.totalColorAliases === beforeAlias.totalColorAliases + 1,
      `item ${beforeAlias.totalItemAliases}→${afterAlias.totalItemAliases}, color ${beforeAlias.totalColorAliases}→${afterAlias.totalColorAliases}`,
    );
    const aliasTop = afterAlias.topCustomers.find((c) => c.customerId === customerId);
    check(
      "aliasStats topCustomers bizim müşteriyi 1 item + 1 color ile listeliyor",
      !!aliasTop && aliasTop.itemAliases === 1 && aliasTop.colorAliases === 1,
      aliasTop ? `item=${aliasTop.itemAliases} color=${aliasTop.colorAliases}` : "müşteri topCustomers'da yok",
    );

    // -----------------------------------------------------------------------
    // 5) INVENTORY — getStockDistribution: TEST WAREHOUSE rulosu byItemColor'da
    // -----------------------------------------------------------------------
    const STOCK_QTY = 77.5;
    const beforeStock = await getStockDistribution();
    const sr = await prisma.roll.create({
      data: {
        barcode: `TEST-RPT-STK-${ts}`,
        itemId: item.id,
        colorId: color.id,
        status: "WAREHOUSE",
        currentQty: STOCK_QTY,
        initialQty: STOCK_QTY,
        qualityGrade: "A",
        width: 160,
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    stockRollId = sr.id;

    const afterStock = await getStockDistribution();
    check(
      "stockDistribution totalQty yarattığımız WAREHOUSE rulosu kadar arttı",
      round1(afterStock.totalQty - beforeStock.totalQty) === round1(STOCK_QTY) &&
        afterStock.totalRolls === beforeStock.totalRolls + 1,
      `qty +${round1(afterStock.totalQty - beforeStock.totalQty)} (beklenen ${STOCK_QTY}), rolls ${beforeStock.totalRolls}→${afterStock.totalRolls}`,
    );
    const icRow = afterStock.byItemColor.find((r) => r.itemName === item.name && r.colorName === color.name);
    check(
      "stockDistribution byItemColor satırı bizim ürün+renk için var",
      !!icRow && icRow.rollCount >= 1 && icRow.totalQty >= STOCK_QTY,
      icRow ? `count=${icRow.rollCount} qty=${icRow.totalQty}` : "ürün+renk satırı yok",
    );

    // -----------------------------------------------------------------------
    // 6) AUDIT — getSystemLogSummary + getUserActivity: 3 TEST log (C/U/D)
    // -----------------------------------------------------------------------
    const beforeLog = await getSystemLogSummary(range);
    const baseAction = (a: string) => beforeLog.byAction.find((r) => r.action === a)?.count ?? 0;
    const baseCreate = baseAction("CREATE");
    const baseUpdate = baseAction("UPDATE");
    const baseDelete = baseAction("DELETE");
    const baseTotal = beforeLog.totalLogs;

    const logTable = `TEST-RPT-LOG-${ts}`;
    for (const action of ["CREATE", "UPDATE", "DELETE"] as const) {
      const log = await prisma.systemLog.create({
        data: {
          userId: user.id,
          category: "DOMAIN",
          action,
          tableName: logTable,
          recordId: `TEST-${ts}`,
          createdAt: ANCHOR,
        },
        select: { id: true },
      });
      systemLogIds.push(log.id);
    }

    const afterLog = await getSystemLogSummary(range);
    const afterAction = (a: string) => afterLog.byAction.find((r) => r.action === a)?.count ?? 0;
    check(
      "systemLogSummary action kırılımı tam 1'er C/U/D arttı + toplam +3",
      afterLog.totalLogs === baseTotal + 3 &&
        afterAction("CREATE") === baseCreate + 1 &&
        afterAction("UPDATE") === baseUpdate + 1 &&
        afterAction("DELETE") === baseDelete + 1,
      `total ${baseTotal}→${afterLog.totalLogs}`,
    );
    const tableRow = afterLog.byTable.find((r) => r.tableName === logTable);
    check(
      "systemLogSummary byTable bizim tabloyu 3 ile listeliyor",
      !!tableRow && tableRow.count === 3,
      tableRow ? `count=${tableRow.count}` : "tablo byTable'da yok (LIMIT 30 dışında olabilir)",
    );

    const activity = await getUserActivity(range);
    const myActivity = activity.find((r) => r.userId === user.id);
    check(
      "userActivity admin satırı bizim 3 log'u (>=) içeriyor + breakdown >=1",
      !!myActivity &&
        myActivity.createCount >= 1 &&
        myActivity.updateCount >= 1 &&
        myActivity.deleteCount >= 1 &&
        myActivity.totalCount >= 3,
      myActivity
        ? `C=${myActivity.createCount} U=${myActivity.updateCount} D=${myActivity.deleteCount} total=${myActivity.totalCount}`
        : "admin aktivitesi yok",
    );

    // -----------------------------------------------------------------------
    // 7) QUALITY — getStationDefectRate: WO + step + roll + roll_error(detectedAtStep)
    //    İstasyon başına defectCount'u kendi hatamızla doğrula (happy-path).
    // -----------------------------------------------------------------------
    const station = await prisma.station.findFirst({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    if (!station) throw new Error("Seed station yok (npm run seed)");

    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-RPT-WO-${ts}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS" },
      select: { id: true },
    });
    workOrderId = wo.id;
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
      select: { id: true },
    });
    workOrderStepId = step.id;

    const dr = await prisma.roll.create({
      data: {
        barcode: `TEST-RPT-DEF-${ts}`,
        itemId: item.id,
        status: "IN_PRODUCTION",
        currentQty: 30,
        initialQty: 30,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    defectRollId = dr.id;

    const beforeRate = await getStationDefectRate(range);
    const baseStationDefects =
      beforeRate.find((r) => r.stationId === station.id)?.defectCount ?? 0;

    // 2 hata bu istasyonda tespit edildi (detectedAtStepId=step, detectedAt range içinde)
    for (const meter of [5, 12]) {
      const e = await prisma.rollError.create({
        data: {
          rollId: dr.id,
          defectTypeId: defect.id,
          errorType: defect.name,
          startMeter: meter,
          isProcessed: false,
          detectedAtStepId: step.id,
          detectedAt: ANCHOR,
        },
        select: { id: true },
      });
      rollErrorIds.push(e.id);
    }

    const afterRate = await getStationDefectRate(range);
    const stationRow = afterRate.find((r) => r.stationId === station.id);
    check(
      "stationDefectRate istasyonun defectCount'u yarattığımız +2 hata kadar arttı",
      !!stationRow && stationRow.defectCount === baseStationDefects + 2 && stationRow.stationName === station.name,
      stationRow ? `defects ${baseStationDefects}→${stationRow.defectCount}` : "istasyon satırı yok",
    );

    // -----------------------------------------------------------------------
    // 8) QUALITY/PRODUCTION — getDefectDistribution + getQc2Decisions + getScrapSummary
    //    (stale-enum bug'ı CUT/NO_CUT'a düzeltildi → happy-path). 2 hatamızı Tambur
    //    kararıyla kapat: biri CUT (scrap), biri NO_CUT (hataya rağmen tutuldu).
    //    ANCHOR=2099 → range'de yalnız bu testin verisi var → KESİN sayı doğrulanır.
    // -----------------------------------------------------------------------
    await prisma.rollError.update({
      where: { id: rollErrorIds[0] },
      data: { isProcessed: true, processedAt: ANCHOR, actionTaken: "CUT" },
    });
    await prisma.rollError.update({
      where: { id: rollErrorIds[1] },
      data: { isProcessed: true, processedAt: ANCHOR, actionTaken: "NO_CUT" },
    });

    const dist = await getDefectDistribution(range);
    const myDist = dist.find((d) => d.defectName === defect.name);
    check(
      "getDefectDistribution: defektimiz count=2, scrap(CUT)=1, keptAsA1(NO_CUT)=1, noAction=0",
      !!myDist &&
        myDist.count === 2 &&
        myDist.scrapCount === 1 &&
        myDist.keptAsA1Count === 1 &&
        myDist.noActionCount === 0,
      myDist
        ? `count=${myDist.count} scrap=${myDist.scrapCount} keptA1=${myDist.keptAsA1Count} noAct=${myDist.noActionCount}`
        : "defekt satırı yok",
    );

    const qc2 = await getQc2Decisions(range);
    check(
      "getQc2Decisions: CUT→scrapClosed=1, NO_CUT→keptAsA1=1, totalErrorsClosed=2 (22P02 yok)",
      qc2.scrapClosed === 1 && qc2.keptAsA1 === 1 && qc2.totalErrorsClosed === 2,
      `scrap=${qc2.scrapClosed} keptA1=${qc2.keptAsA1} closed=${qc2.totalErrorsClosed}`,
    );

    const scrap = await getScrapSummary(range);
    const myScrap = scrap.byDefect.find((d) => d.defectName === defect.name);
    check(
      "getScrapSummary: CUT hatamız byDefect'te count=1 (22P02 yok)",
      Array.isArray(scrap.byDefect) && !!myScrap && myScrap.count === 1,
      myScrap ? `count=${myScrap.count}` : "byDefect satırı yok",
    );

    // 9) PRODUCTION — getOperatorPerformance: eskiden satır içi 'PACKAGED' (RollOperationType'da
    //    YOK) literali yüzünden HER çağrıda 22P02/500 atıyordu (packageCount kolonu kaldırıldı).
    //    Admin'e 1 QC2_COMPLETED operasyonu yaz, raporun operatörü doğru saydığını doğrula.
    const op = await prisma.rollOperation.create({
      data: {
        rollId: defectRollId,
        workOrderStepId: workOrderStepId,
        operationType: "QC2_COMPLETED",
        operatorId: user.id,
        createdAt: ANCHOR,
      },
      select: { id: true },
    });
    rollOperationId = op.id;
    const perf = await getOperatorPerformance(range);
    const myPerf = perf.find((r) => r.userId === user.id);
    check(
      "getOperatorPerformance: admin satırı qc2Count=1 + totalOps=1 (PACKAGED 22P02 yok)",
      !!myPerf && myPerf.qc2Count === 1 && myPerf.totalOps === 1 && myPerf.kursunCount === 0,
      myPerf ? `qc2=${myPerf.qc2Count} total=${myPerf.totalOps}` : "operatör satırı yok",
    );
  } finally {
    // Cleanup — kendi yarattıklarımızı sil (ters bağımlılık sırası)
    if (rollOperationId) await prisma.rollOperation.delete({ where: { id: rollOperationId } }).catch(() => {});
    for (const id of rollErrorIds) await prisma.rollError.delete({ where: { id } }).catch(() => {});
    for (const id of systemLogIds) await prisma.systemLog.delete({ where: { id } }).catch(() => {});
    if (aliasItemId) await prisma.customerItemAlias.delete({ where: { id: aliasItemId } }).catch(() => {});
    if (aliasColorId) await prisma.customerColorAlias.delete({ where: { id: aliasColorId } }).catch(() => {});
    if (stockRollId) await prisma.roll.delete({ where: { id: stockRollId } }).catch(() => {});
    if (defectRollId) await prisma.roll.delete({ where: { id: defectRollId } }).catch(() => {});
    if (workOrderStepId) await prisma.workOrderStep.delete({ where: { id: workOrderStepId } }).catch(() => {});
    if (workOrderId) await prisma.workOrder.delete({ where: { id: workOrderId } }).catch(() => {});
    for (const id of orderLineIds) await prisma.orderLine.delete({ where: { id } }).catch(() => {});
    if (orderFulfillId) await prisma.order.delete({ where: { id: orderFulfillId } }).catch(() => {});
    if (orderLateId) await prisma.order.delete({ where: { id: orderLateId } }).catch(() => {});
    if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
