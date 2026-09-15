// =============================================================================
// Test: Rapor servisleri (src/services/reports/*) — happy-path, kendi fixture'ı
// Çalıştır: npx tsx scripts/test_reports.ts
// =============================================================================
// KAPSAM 2026-08-09'da DARALDI. O tarihte 12 eski rapor kaldırıldı (yerlerini
// beş "karne" aldı) ve bu dosyanın onlara ait kontrolleri de silindi. Kalanlar:
//   customer   → getCustomerOrderProfiles
//   audit      → getSystemLogSummary, getUserActivity
//
// ⚠️ Fixture kurulumu BİLİNÇLİ OLARAK OLDUĞU GİBİ BIRAKILDI. İlk denemede
// bölüm bölüm kesilmişti ve sonraki bölümler o fixture'lara dayandığı için iki
// kontrol çöktü (boş uuid ile `rollOperation.create`). Kullanılmayan birkaç
// fixture satırı, kırık bir test zincirinden ucuzdur.
//
// Yerini alan karnelerin bekçileri AYRI ve çok daha derindir:
//   test_quality_scorecard · test_scrap_scorecard · test_return_scorecard
//   test_subcontract_scorecard · test_shipment_scorecard · test_wip_scorecard
//   test_stock_scorecard
// =============================================================================
import prisma from "../src/lib/prisma";
import type { DateRange } from "../src/services/reports/_shared";
import { getCustomerOrderProfiles } from "../src/services/reports/customer.report.service";
import { getSystemLogSummary, getUserActivity } from "../src/services/reports/audit.report.service";
import { getOperatorPerformance } from "../src/services/reports/production.report.service";

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


    // -----------------------------------------------------------------------
    // 3) CUSTOMER — getCustomerOrderProfiles: müşteri agg + favori ürün/renk
    // -----------------------------------------------------------------------
    const profiles = (await getCustomerOrderProfiles()).rows; // R5b-c3: satırlar + meta.secenekler
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

    // -----------------------------------------------------------------------
    // 5) INVENTORY — getStockDistribution: TEST WAREHOUSE rulosu byItemColor'da
    // -----------------------------------------------------------------------
    const STOCK_QTY = 77.5;
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
      // ORDER_PRODUCTION: rapor (istasyon hata oranı) WO tipine duyarsız; STOCK_PRODUCTION
      // artık DB CHECK'i ile targetItemId ister (migration 20260731120000).
      data: { workOrderNumber: `TEST-RPT-WO-${ts}`, type: "ORDER_PRODUCTION", status: "IN_PROGRESS" },
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
