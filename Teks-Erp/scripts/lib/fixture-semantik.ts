// =============================================================================
// SEMANTİK KÜP FİKSTÜRÜ — `test_semantik_sayi_esitligi` için DOLU veri (Raporlar v2 R1-SEMKUP)
// =============================================================================
// Boş veriyle eşitlik kanıt değildir: her küp en az iki boyut değeriyle beslenir. Pencere 2098-03
// (başka bekçilerle çakışmaz). Senaryo: gece yarısını aşan vardiya (22:00 + 480 dk) · K18 ölü top ·
// SCRAP · iade · terminsiz sipariş · iptal sipariş + iptal kalem · açık/kapalı fason kalemi ·
// iki para birimli açık fatura · mühürlü tezgah vardiyası (sebepli + kısa + sınıfsız duruş).
// Levent: kapanmış levent kurmak tam devere yaşam döngüsü ister → levent ölçüleri BOŞ veriyle
// eşitlenir (iki taraf da "ölçülemedi"); bekçi bunu notla yazar.
//
// İdempotent + sırasız: her koşu önce iş anahtarı öneki (`TSE-FIX`) taşıyan kayıtları siler, sonra kurar.
// Yalnız `tekserp_*_test` DB'ye yazar (`hedefDbEngeli`).
// `scripts/lib/` altında: fikstürdür, defter sınıflaması (`test_defter_ters_yol §8a`) gerekmez.
// Koşum: npx tsx scripts/lib/fixture-semantik.ts [kur|sil]
// =============================================================================
import prisma, { pool } from "../../src/lib/prisma";
import { hedefDbEngeli } from "./hedef-db-kapisi";
import { firstGrade, roleGrade } from "../fixture-quality-grade";
import { K18_DEAD_STATUSES } from "../../src/services/batch.service";
import { DEFECT_GROUPS } from "../../src/constants/hata-gruplari";
import type { DateRange } from "../../src/services/reports/_shared";

export const FIXTURE_TAG = "TSE-FIX";
/** Fabrika ayı 2098-03 (İstanbul UTC+3). */
export const FIXTURE_RANGE: DateRange = { from: new Date("2098-02-28T21:00:00.000Z"), to: new Date("2098-03-31T20:59:59.999Z") };
export const FIXTURE_DAYS = { from: "2098-03-01", to: "2098-03-31" };
/** 2098-03-10 22:00 İstanbul vardiyasının içi; fabrika saatiyle 11 Mart 00:30 (gece yarısı aşar). */
const NIGHT = new Date("2098-03-10T21:30:00.000Z");
const DAY = new Date("2098-03-15T08:00:00.000Z");
const OUTSIDE = new Date("2098-06-15T08:00:00.000Z");

export interface SemanticFixture {
  items: [string, string];
  colors: [string, string];
  customers: [string, string];
  subcontractors: [string, string];
  stations: [string, string];
  looms: [string, string];
  defectTypes: [string, string];
  shiftDefinitionId: string;
  shiftCode: string;
  operatorId: string;
  deadRollQty: number;
}

const T = FIXTURE_TAG;
const starts = { startsWith: T };

export async function teardownSemanticFixture(): Promise<void> {
  const rolls = (await prisma.roll.findMany({ where: { barcode: starts }, select: { id: true } })).map((r) => r.id);
  const customers = (await prisma.customer.findMany({ where: { code: starts }, select: { id: true } })).map((c) => c.id);
  const looms = (await prisma.machine.findMany({ where: { code: starts }, select: { id: true } })).map((m) => m.id);
  const defs = (await prisma.shiftDefinition.findMany({ where: { name: starts }, select: { id: true } })).map((d) => d.id);
  const stats = (await prisma.machineShiftStat.findMany({ where: { machineId: { in: looms } }, select: { id: true } })).map((s) => s.id);
  const cariIds = (await prisma.cariAccount.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((c) => c.id);

  await prisma.machineShiftStopBreakdown.deleteMany({ where: { statId: { in: stats } } });
  await prisma.machineShiftStat.deleteMany({ where: { id: { in: stats } } });
  await prisma.shiftInstance.deleteMany({ where: { shiftDefinitionId: { in: defs } } });
  await prisma.shiftDefinition.deleteMany({ where: { id: { in: defs } } });
  await prisma.machine.deleteMany({ where: { id: { in: looms } } });
  await prisma.invoice.deleteMany({ where: { docNo: starts } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
  await prisma.rollError.deleteMany({ where: { rollId: { in: rolls } } });
  await prisma.rollInspection.deleteMany({ where: { rollId: { in: rolls } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rolls } } });
  await prisma.rollReturn.deleteMany({ where: { rollId: { in: rolls } } });
  await prisma.subcontractorReceiptItem.deleteMany({ where: { receipt: { receiptNo: starts } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { receiptNo: starts } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { dispatchNo: starts } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { dispatchNo: starts } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: rolls } } });
  await prisma.roll.deleteMany({ where: { id: { in: rolls } } });
  await prisma.shipment.deleteMany({ where: { shipmentNo: starts } });
  await prisma.orderLine.deleteMany({ where: { order: { orderNumber: starts } } });
  await prisma.order.deleteMany({ where: { orderNumber: starts } });
  await prisma.batch.deleteMany({ where: { batchNumber: starts } });
  await prisma.workOrderStep.deleteMany({ where: { workOrder: { workOrderNumber: starts } } });
  await prisma.workOrder.deleteMany({ where: { workOrderNumber: starts } });
  await prisma.defectType.deleteMany({ where: { code: starts } });
  await prisma.station.deleteMany({ where: { code: starts } });
  await prisma.subcontractor.deleteMany({ where: { code: starts } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.color.deleteMany({ where: { code: starts } });
  await prisma.item.deleteMany({ where: { code: starts } });
  await prisma.reportRun.deleteMany({ where: { user: { username: `${T}-op`.toLowerCase() } } });
  await prisma.user.deleteMany({ where: { username: `${T}-op`.toLowerCase() } });
}

export async function setupSemanticFixture(): Promise<SemanticFixture> {
  await teardownSemanticFixture();
  const op = await prisma.user.create({ data: { username: `${T}-op`.toLowerCase(), passwordHash: "x", fullName: `${T} Operatör` }, select: { id: true } });
  const item = async (k: string) => (await prisma.item.create({ data: { code: `${T}-${k}`, name: `${T} ${k}`, itemType: "FABRIC" }, select: { id: true } })).id;
  const color = async (k: string) => (await prisma.color.create({ data: { code: `${T}-${k}`, name: `${T} ${k}` }, select: { id: true } })).id;
  const customer = async (k: string) => (await prisma.customer.create({ data: { code: `${T}-${k}`, name: `${T} ${k}` }, select: { id: true } })).id;
  const items: [string, string] = [await item("I1"), await item("I2")];
  const colors: [string, string] = [await color("C1"), await color("C2")];
  const customers: [string, string] = [await customer("K1"), await customer("K2")];
  const first = await firstGrade();
  const second = await roleGrade("SECOND");

  let n = 0;
  const roll = async (o: { item: string; color: string | null; qty: number; status: string; grade: string | null; finalizedAt: Date | null; shipmentId?: string }) =>
    (await prisma.roll.create({
      data: {
        itemId: o.item, colorId: o.color, initialQty: o.qty, currentQty: o.qty, status: o.status as never, entrySource: "SUPPLIER_RECEIPT",
        qualityGradeId: o.grade, finalizedAt: o.finalizedAt, barcode: `${T}-R${n++}`, ...(o.shipmentId ? { shipmentId: o.shipmentId } : {}),
      },
      select: { id: true },
    })).id;

  // Üretim/kalite: birinci 500 + 300, ikinci 120, hurda 40, K18 ölü 999 (sayılmamalı), pencere dışı 777.
  const deadRollQty = 999;
  const r1 = await roll({ item: items[0], color: colors[0], qty: 500, status: "WAREHOUSE", grade: first.id, finalizedAt: NIGHT });
  const r2 = await roll({ item: items[0], color: colors[1], qty: 120, status: "A1_STOCK", grade: second.id, finalizedAt: DAY });
  const r3 = await roll({ item: items[1], color: colors[0], qty: 300, status: "WAREHOUSE", grade: first.id, finalizedAt: DAY });
  const r4 = await roll({ item: items[1], color: colors[1], qty: 40, status: "SCRAP", grade: second.id, finalizedAt: NIGHT });
  await roll({ item: items[0], color: colors[0], qty: deadRollQty, status: K18_DEAD_STATUSES[0]!, grade: first.id, finalizedAt: DAY });
  await roll({ item: items[0], color: colors[0], qty: 777, status: "WAREHOUSE", grade: first.id, finalizedAt: OUTSIDE });

  // İstasyon akışı + hata tespiti: iki istasyon, kapanmış/açık/geri alınmış hareket.
  const station = async (k: string) => (await prisma.station.create({ data: { code: `${T}-${k}`, name: `${T} ${k}`, type: "INTERNAL", kind: "PROCESS_QC" }, select: { id: true } })).id;
  const stations: [string, string] = [await station("S1"), await station("S2")];
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${T}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  const step = async (stationId: string, seq: number) => (await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId, stepSequence: seq }, select: { id: true } })).id;
  const [st1, st2] = [await step(stations[0], 1), await step(stations[1], 2)];
  const move = (rollId: string, stepId: string, qty: number, exitedAt: Date | null, revokedAt: Date | null = null) =>
    prisma.rollMovement.create({ data: { rollId, workOrderStepId: stepId, qtyIn: qty, enteredAt: new Date(DAY.getTime() - 3_600_000), exitedAt, revokedAt, operatorId: op.id } });
  await move(r1, st1, 500, NIGHT);
  await move(r2, st1, 120, DAY);
  await move(r3, st2, 300, DAY);
  await move(r2, st2, 120, DAY, DAY); // geri alınmış — sayılmaz
  await move(r4, st2, 40, null); // açık — bekleyen

  const defect = async (k: string, group: string) => (await prisma.defectType.create({ data: { code: `${T}-${k}`, name: `${T} ${k}`, defectGroup: group }, select: { id: true } })).id;
  const defectTypes: [string, string] = [await defect("D1", DEFECT_GROUPS[0]), await defect("D2", DEFECT_GROUPS[1])];
  // Muayene satırı (K4P) CHECK'i muayene kaydı + puan ister.
  const inspection = (await prisma.rollInspection.create({
    data: { rollId: r3, phase: "FINAL", revision: 1, inspectedLengthM: 300, widthSource: "UNKNOWN", totalPoints: 2, defectCount: 1, unplacedDefectCount: 0, ruleSnapshot: {}, gradeMismatch: false, inspectedById: op.id, inspectedAt: DAY },
    select: { id: true },
  })).id;
  // K4P-RAPOR muayene küpü: aktif puanlı iki muayene (r1 Ham, r2 Mamul) + iptal edilmiş (sayılmaz) + pencere dışı.
  const insp = (rollId: string, phase: "RAW" | "FINAL", score: number, at: Date, voided = false) =>
    prisma.rollInspection.create({ data: {
      rollId, phase, revision: 1, inspectedLengthM: 100, widthSource: "ITEM_CARD", widthCm: 150, totalPoints: 10, defectCount: 2, unplacedDefectCount: 0,
      pointsPer100M2: score, ruleSnapshot: {}, gradeMismatch: false, inspectedById: op.id, inspectedAt: at, ...(voided ? { voidedAt: at, voidedById: op.id, voidReason: "fikstür" } : {}),
    } });
  await insp(r1, "RAW", 50, NIGHT, true);
  await insp(r1, "RAW", 12.5, NIGHT);
  await insp(r2, "FINAL", 20.25, DAY);
  await insp(r4, "RAW", 99, OUTSIDE);
  const error = (rollId: string, defectTypeId: string, stepId: string | null, origin: "PROCESS" | "INSPECTION", detectedAt: Date) =>
    prisma.rollError.create({ data: { rollId, defectTypeId, detectedAtStepId: stepId, origin, detectedAt, startMeter: 10, ...(origin === "INSPECTION" ? { inspectionId: inspection, points: 2 } : {}) } });
  await error(r1, defectTypes[0], st1, "PROCESS", NIGHT);
  await error(r1, defectTypes[1], st1, "PROCESS", DAY);
  await error(r3, defectTypes[0], st2, "INSPECTION", DAY);
  await error(r4, defectTypes[1], st2, "PROCESS", NIGHT);
  await error(r3, defectTypes[0], st2, "PROCESS", OUTSIDE);

  // Sipariş: iki müşteri, iki yön; iptal kalem + iptal sipariş sayılmaz; terminsiz sipariş.
  // Tutar: O1 TRY (300 × 10 + fiyatsız 200), O2 USD (150 × 4) → iki para birimi, fiyatsız satır sıfır sayılmaz.
  const order = async (k: string, customerId: string, destination: "DOMESTIC" | "EXPORT", status: "APPROVED" | "CANCELLED", deadline: Date | null, lines: Array<[string, string | null, number, boolean, number?]>, currency: "TRY" | "USD" = "TRY") => {
    const o = await prisma.order.create({ data: { orderNumber: `${T}-${k}`, customerId, destination, status, orderDate: DAY, deadline, currency }, select: { id: true } });
    for (const [itemId, colorId, quantity, cancelled, unitPrice] of lines) {
      await prisma.orderLine.create({ data: { orderId: o.id, itemId, colorId, quantity, ...(unitPrice !== undefined ? { unitPrice } : {}), ...(cancelled ? { cancelledAt: DAY } : {}) } });
    }
    return o.id;
  };
  await order("O1", customers[0], "DOMESTIC", "APPROVED", new Date("2098-03-20T09:00:00.000Z"), [[items[0], colors[0], 300, false, 10], [items[1], colors[1], 200, false], [items[0], colors[1], 50, true, 10]]);
  await order("O2", customers[1], "EXPORT", "APPROVED", null, [[items[0], colors[0], 150, false, 4]], "USD");
  await order("O3", customers[0], "DOMESTIC", "CANCELLED", null, [[items[1], colors[0], 999, false]]);

  // Sevk + iade (brüt): K1'e 100 + 50, K2'ye 30; 40 m iade.
  const shipment = async (k: string, customerId: string, destination: "DOMESTIC" | "EXPORT") =>
    (await prisma.shipment.create({ data: { shipmentNo: `${T}-${k}`, customerId, destination, status: "DISPATCHED", dispatchedAt: DAY }, select: { id: true } })).id;
  const sh1 = await shipment("SH1", customers[0], "DOMESTIC");
  const sh2 = await shipment("SH2", customers[1], "EXPORT");
  await roll({ item: items[0], color: colors[0], qty: 100, status: "SHIPPED", grade: null, finalizedAt: null, shipmentId: sh1 });
  await roll({ item: items[0], color: colors[0], qty: 50, status: "SHIPPED", grade: null, finalizedAt: null, shipmentId: sh1 });
  await roll({ item: items[1], color: colors[1], qty: 30, status: "SHIPPED", grade: null, finalizedAt: null, shipmentId: sh2 });
  const back = await roll({ item: items[0], color: colors[0], qty: 40, status: "WAREHOUSE", grade: null, finalizedAt: null });
  await prisma.rollReturn.create({ data: { rollId: back, customerId: customers[0], itemId: items[0], qty: 40, receivedById: op.id, fromShipmentId: sh1, createdAt: DAY } });

  // Fason: A'ya 100 + 200 (100 → 90 döndü), B'ye 70 açık.
  const ext = (await prisma.station.create({ data: { code: `${T}-EXT`, name: `${T} EXT`, type: "EXTERNAL" }, select: { id: true } })).id;
  const extStep = await step(ext, 3);
  const batch = await prisma.batch.create({ data: { batchNumber: `${T}-B`, workOrderId: wo.id }, select: { id: true } });
  const sub = async (k: string) => (await prisma.subcontractor.create({ data: { code: `${T}-${k}`, name: `${T} Boyahane ${k}` }, select: { id: true } })).id;
  const subcontractors: [string, string] = [await sub("FA"), await sub("FB")];
  let d = 0;
  const dispatch = async (subId: string, qtys: number[]) => {
    const dp = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${T}-SD${d++}`, workOrderId: wo.id, batchId: batch.id, stepId: extStep, subcontractorId: subId, dispatchedAt: new Date("2098-03-05T08:00:00.000Z") }, select: { id: true } });
    const out: string[] = [];
    for (const q of qtys) {
      const rid = await roll({ item: items[0], color: null, qty: q, status: "AT_SUBCONTRACTOR", grade: null, finalizedAt: null });
      out.push((await prisma.subcontractorDispatchItem.create({ data: { dispatchId: dp.id, rollId: rid, dispatchedQty: q }, select: { id: true } })).id);
    }
    return out;
  };
  const [a1] = await dispatch(subcontractors[0], [100, 200]);
  await dispatch(subcontractors[1], [70]);
  const rc = await prisma.subcontractorReceipt.create({ data: { receiptNo: `${T}-SR0`, subcontractorId: subcontractors[0], workOrderId: wo.id, stepId: extStep, receivedAt: new Date("2098-03-09T08:00:00.000Z") }, select: { id: true } });
  const newRoll = await roll({ item: items[0], color: null, qty: 90, status: "AT_SUBCONTRACTOR", grade: null, finalizedAt: null });
  await prisma.subcontractorReceiptItem.create({ data: { receiptId: rc.id, newRollId: newRoll, sourceDispatchItemId: a1! } });

  // Dokuma: iki tezgah × gece vardiyası, mühürlü satır + duruş kırılımı (sebepli · kısa · sınıfsız).
  const weaving = (await prisma.station.create({ data: { code: `${T}-W`, name: `${T} Dokuma`, type: "INTERNAL", kind: "WEAVING" }, select: { id: true } })).id;
  const loom = async (k: string) => (await prisma.machine.create({ data: { stationId: weaving, code: `${T}-${k}`, name: `${T} ${k}` }, select: { id: true } })).id;
  const looms: [string, string] = [await loom("L1"), await loom("L2")];
  const shiftCode = "TSEN";
  const def = await prisma.shiftDefinition.create({ data: { code: shiftCode, name: `${T} gece`, startMinute: 22 * 60, durationMinutes: 480 }, select: { id: true } });
  const inst = await prisma.shiftInstance.create({
    data: { shiftDefinitionId: def.id, factoryDayKey: new Date("2098-03-10T00:00:00.000Z"), startsAt: new Date("2098-03-10T19:00:00.000Z"), endsAt: new Date("2098-03-11T03:00:00.000Z") },
    select: { id: true },
  });
  const stat = async (machineId: string, aptSec: number, units: number, breakdown: Array<[string | null, string | null, number, number]>) => {
    const s = await prisma.machineShiftStat.create({
      data: {
        machineId, shiftInstanceId: inst.id, factoryDay: new Date("2098-03-10T00:00:00.000Z"), stopThresholdSec: 120, source: "SIMULATED", monitoringState: "LIVE",
        calendarSec: 28_800, potSec: 28_800, aptSec, unplannedDownSec: 28_800 - aptSec, unitsActual: units,
        targetUnitCapacityPot: 120_000, targetUnitCapacityApt: Math.round((120_000 * aptSec) / 28_800),
        stopCount: breakdown.reduce((a, b) => a + b[2], 0), sealState: "SEALED", sealGeneration: 1, sealedAt: DAY,
      },
      select: { id: true },
    });
    for (const [reasonCode, lossClass, stopCount, stopSec] of breakdown) {
      await prisma.machineShiftStopBreakdown.create({ data: { statId: s.id, sealGeneration: 1, reasonCode, reasonLabel: reasonCode, lossClass: lossClass as never, stopCount, stopSec } });
    }
  };
  await stat(looms[0], 25_000, 95_000, [["COZGU_KOPUSU", null, 3, 1_800], ["ATKI_KOPUSU", "MINOR", 10, 600], [null, null, 1, 300]]);
  await stat(looms[1], 27_000, 105_000, [["ATKI_KOPUSU", null, 2, 900]]);

  // Alacak: TRY vadesi geçmiş 1000 + vadesi gelmemiş 500; USD vadesi geçmiş 300 (K2).
  const cari = async (customerId: string) => (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId }, select: { id: true } })).id;
  const [c1, c2] = [await cari(customers[0]), await cari(customers[1])];
  let inv = 0;
  const invoice = (cariId: string, currency: "TRY" | "USD", total: number, due: string) =>
    prisma.invoice.create({
      data: {
        docNo: `${T}-INV${inv++}`, type: "SALES", status: "CONFIRMED", cariId, currency, issueDate: new Date("2098-01-10T09:00:00.000Z"),
        dueDate: new Date(due), subtotal: total, grandTotal: total, grandTotalTry: total, confirmedAt: new Date("2098-01-10T09:00:00.000Z"),
      },
    });
  await invoice(c1, "TRY", 1000, "2098-02-10T09:00:00.000Z");
  await invoice(c1, "TRY", 500, "2098-04-30T09:00:00.000Z");
  await invoice(c2, "USD", 300, "2098-02-01T09:00:00.000Z");

  return { items, colors, customers, subcontractors, stations, looms, defectTypes, shiftDefinitionId: def.id, shiftCode, operatorId: op.id, deadRollQty };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  if (process.argv[2] === "sil") await teardownSemanticFixture();
  else console.log(JSON.stringify(await setupSemanticFixture(), null, 2));
}

if (process.argv[1]?.endsWith("fixture-semantik.ts")) {
  main()
    .catch((e) => {
      console.error("HATA:", e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
