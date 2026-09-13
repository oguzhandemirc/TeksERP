// TEST: Fasondan Doğrudan Sevk — fason fiilen son durak; mal dönmeden müşteriye sevk.
//
// Senaryo: WO rotası [1] Boyahane(Fason) → [2] Tambur(internal). Boyahaneye sevk
// edilen mal fasondan bize DÖNMEDEN doğrudan sevk edilir → executeDirectShip:
//   - toplar SUBCONTRACTOR_CONSUMED, currentStepId=null
//   - Boyahane adımı COMPLETED, Tambur adımı SKIPPED (FASON_DIRECT_SHIP)
//   - WO COMPLETED + TravelerCard COMPLETED
//   - dispatch directShipped* işaretli + donmuş PrintedDocument
//   - (ops.) seçilen OrderLine.shippedQty artar + DirectShipAllocation satırı
// + idempotency, karşılanmasız yol, guard'lar (kabul edilmiş / iptal / top kaçtı).
//
// Çalıştır: npx tsx scripts/test_direct_ship_fason.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import {
  RollStatus,
  StepStatus,
  WorkOrderStatus,
  PrintedDocType,
  PrintedDocStatus,
  TravelerCardStatus,
} from "@prisma/client";

let ITEM = "";
let GRADE = "";
 let GRADE_CODE = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_TAMBUR = "";
let SUB_BOYER = "";
let CUSTOMER = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "Customer MUS-001");
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-DS-${rand}${bc}`;
}

const createdWoIds: string[] = [];
const allStepIds: string[] = [];
const createdOrderIds: string[] = [];

async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      qualityGrade: GRADE_CODE,
      qualityGradeId: GRADE,
      width: WIDTH,
      createdById: ADMIN,
    },
  });
  return r.id;
}

async function makeWo(
  steps: Array<{ stationId: string; seq: number }>,
): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 100);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-DS-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: { create: steps.map((s) => ({ stationId: s.stationId, stepSequence: s.seq, status: "PENDING" as const })) },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  createdWoIds.push(wo.id);
  const stepIds = wo.steps.map((s) => s.id);
  allStepIds.push(...stepIds);
  return { woId: wo.id, stepIds };
}

async function makeOrderWithLine(qty: number): Promise<{ orderId: string; lineId: string }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 100);
  const order = await prisma.order.create({
    data: {
      orderNumber: `TST-DS-ORD-${stamp}`,
      customerId: CUSTOMER,
      status: "APPROVED",
      lines: { create: [{ itemId: ITEM, colorId: null, width: WIDTH, quantity: qty }] },
    },
    include: { lines: true },
  });
  createdOrderIds.push(order.id);
  return { orderId: order.id, lineId: order.lines[0].id };
}

async function main(): Promise<void> {
  await resolveFixtures();

  // ===========================================================================
  // TEST A — Ana akış + karşılanma + idempotency
  // ===========================================================================
  console.log("\n=== TEST A: Boyahane(son durak) → Tambur(atlanacak) + karşılanma ===");
  const { woId: woA, stepIds: stepsA } = await makeWo([
    { stationId: ST_BOYA, seq: 1 },
    { stationId: ST_TAMBUR, seq: 2 },
  ]);
  const [boyaA, tamburA] = stepsA;
  const r1 = await stockRoll(300);
  const r2 = await stockRoll(300);
  const { lineId } = await makeOrderWithLine(1000);

  const disp = await sub.dispatch(
    { workOrderId: woA, stepId: boyaA, subcontractorId: SUB_BOYER, rollIds: [r1, r2] },
    ADMIN,
  );
  const dispatchId = (disp.data as { id: string }).id;

  await sub.executeDirectShip(
    { dispatchId, reason: "Boyahane malı doğrudan müşteriye sevk etti", customerId: CUSTOMER, completeWorkOrder: true, orderLineAllocations: [{ orderLineId: lineId, qty: 500 }] },
    ADMIN,
  );

  const rollsA = await prisma.roll.findMany({ where: { id: { in: [r1, r2] } }, select: { status: true, currentStepId: true } });
  check(
    "Toplar SUBCONTRACTOR_CONSUMED + currentStepId=null",
    rollsA.every((r) => r.status === RollStatus.SUBCONTRACTOR_CONSUMED && r.currentStepId === null),
    rollsA.map((r) => r.status).join(","),
  );

  const stepsAfterA = await prisma.workOrderStep.findMany({ where: { id: { in: stepsA } }, select: { id: true, status: true, skipReason: true } });
  const sA = (id: string) => stepsAfterA.find((s) => s.id === id)!;
  check("Boyahane adımı COMPLETED", sA(boyaA).status === StepStatus.COMPLETED, sA(boyaA).status);
  check("Tambur adımı SKIPPED (FASON_DIRECT_SHIP)", sA(tamburA).status === StepStatus.SKIPPED && sA(tamburA).skipReason === "FASON_DIRECT_SHIP", `${sA(tamburA).status}/${sA(tamburA).skipReason}`);

  const woAfterA = await prisma.workOrder.findUnique({ where: { id: woA }, select: { status: true } });
  check("WO COMPLETED", woAfterA?.status === WorkOrderStatus.COMPLETED, String(woAfterA?.status));

  const tcA = await prisma.travelerCard.findFirst({ where: { workOrderId: woA }, select: { status: true } });
  check("TravelerCard COMPLETED", tcA?.status === TravelerCardStatus.COMPLETED, String(tcA?.status));

  const dispA = await prisma.subcontractorDispatch.findUnique({ where: { id: dispatchId }, select: { directShippedAt: true, directShippedById: true, directShipReason: true } });
  check("Dispatch directShipped* işaretli", dispA?.directShippedAt != null && dispA?.directShippedById === ADMIN && !!dispA?.directShipReason);

  const lineA = await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } });
  check("OrderLine.shippedQty 500 arttı", Number(lineA?.shippedQty) === 500, String(lineA?.shippedQty));

  const allocRow = await prisma.subcontractorDirectShipAllocation.findFirst({ where: { dispatchId, orderLineId: lineId }, select: { qty: true } });
  check("SubcontractorDirectShipAllocation satırı (qty=500)", allocRow != null && Number(allocRow.qty) === 500);

  // DirectShipment olay kaydı — customerId artık zorunlu, kayıt sevk anında doğar.
  const dsA = await prisma.directShipment.findFirst({ where: { dispatchId }, select: { id: true, customerId: true } });
  check("DirectShipment kaydı doğdu (customerId doğru)", dsA != null && dsA.customerId === CUSTOMER);
  const dsAId = dsA?.id ?? "00000000-0000-0000-0000-000000000000";

  // Donmuş belge sourceId = DirectShipment.id (dispatch DEĞİL — kısmi/çoklu sevkte olay-başına belge).
  const doc = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP, sourceId: dsAId, status: PrintedDocStatus.ACTIVE }, select: { id: true } });
  check("PrintedDocument SUBCONTRACTOR_DIRECT_SHIP ACTIVE donmuş", doc != null);

  // Tek-kaynak HTML — GERÇEK builder snapshot'ı → renderFasonDirectShipHtml
  // (buildFasonDirectShipDoc → renderer kontratı; rolls + allocations doğru akıyor mu).
  const dsHtml = (await printedDocumentService.getHtml(PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP, dsAId))
    .data as { html: string } | null;
  check("direct-ship getHtml HTML üretti", (dsHtml?.html.length ?? 0) > 500, `len=${dsHtml?.html.length ?? 0}`);
  check("direct-ship getHtml başlık", !!dsHtml && dsHtml.html.includes("FASONDAN SEVK İRSALİYESİ"));
  check("direct-ship getHtml karşılanan sipariş (allocations)", !!dsHtml && dsHtml.html.includes("Karşılanan Siparişler"));
  check("direct-ship getHtml sevk edilen toplar", !!dsHtml && dsHtml.html.includes("Sevk Edilen Toplar"));

  // Idempotency: ikinci çağrı çift-increment YAPMAMALI
  await sub.executeDirectShip({ dispatchId, reason: "tekrar (idempotency)", customerId: CUSTOMER }, ADMIN);
  const lineA2 = await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } });
  check("Idempotency: ikinci çağrı shippedQty'yi çift artırmadı (hâlâ 500)", Number(lineA2?.shippedQty) === 500, String(lineA2?.shippedQty));
  const allocCount = await prisma.subcontractorDirectShipAllocation.count({ where: { dispatchId } });
  check("Idempotency: tek allocation satırı (çift değil)", allocCount === 1, String(allocCount));

  // ===========================================================================
  // TEST B — Karşılanmasız yol (yalnız WO kapanır)
  // ===========================================================================
  console.log("\n=== TEST B: Karşılanmasız (orderLineAllocations boş) — yalnız WO kapanır ===");
  const { woId: woB, stepIds: stepsB } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
  const r3 = await stockRoll(200);
  const { lineId: lineB } = await makeOrderWithLine(500);
  const dispB = await sub.dispatch({ workOrderId: woB, stepId: stepsB[0], subcontractorId: SUB_BOYER, rollIds: [r3] }, ADMIN);
  await sub.executeDirectShip({ dispatchId: (dispB.data as { id: string }).id, reason: "doğrudan sevk, karşılanma yok", customerId: CUSTOMER, completeWorkOrder: true }, ADMIN);
  const woAfterB = await prisma.workOrder.findUnique({ where: { id: woB }, select: { status: true } });
  check("Karşılanmasız: WO COMPLETED", woAfterB?.status === WorkOrderStatus.COMPLETED);
  const lineBafter = await prisma.orderLine.findUnique({ where: { id: lineB }, select: { shippedQty: true } });
  check("Karşılanmasız: ilgisiz OrderLine.shippedQty DEĞİŞMEDİ (0)", Number(lineBafter?.shippedQty) === 0, String(lineBafter?.shippedQty));

  // ===========================================================================
  // TEST C — Guard: kabul edilmiş sevk doğrudan sevk EDİLEMEZ
  // ===========================================================================
  console.log("\n=== TEST C: Guard — kabul edilmiş sevk → 409 ===");
  const { woId: woC, stepIds: stepsC } = await makeWo([{ stationId: ST_BOYA, seq: 1 }, { stationId: ST_TAMBUR, seq: 2 }]);
  const r4 = await stockRoll(150);
  const dispC = await sub.dispatch({ workOrderId: woC, stepId: stepsC[0], subcontractorId: SUB_BOYER, rollIds: [r4] }, ADMIN);
  const dispCId = (dispC.data as { id: string }).id;
  await sub.receive({ workOrderId: woC, stepId: stepsC[0], subcontractorId: SUB_BOYER, returns: [{ rollId: r4 }], newRolls: [{ qty: 140 }] }, ADMIN);
  let errC: string | null = null;
  try {
    await sub.executeDirectShip({ dispatchId: dispCId, reason: "kabul edilmiş sevk denemesi", customerId: CUSTOMER }, ADMIN);
  } catch (e) {
    errC = e instanceof Error ? e.message : String(e);
  }
  check("Kabul edilmiş sevk doğrudan sevk edilemedi (hata)", errC !== null, errC ?? "(hata yok!)");

  // ===========================================================================
  // TEST D — Guard: iptal edilmiş sevk doğrudan sevk EDİLEMEZ
  // ===========================================================================
  console.log("\n=== TEST D: Guard — iptal edilmiş sevk → 409 ===");
  const { woId: woD, stepIds: stepsD } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
  const r5 = await stockRoll(120);
  const dispD = await sub.dispatch({ workOrderId: woD, stepId: stepsD[0], subcontractorId: SUB_BOYER, rollIds: [r5] }, ADMIN);
  const dispDId = (dispD.data as { id: string }).id;
  await sub.cancel(dispDId, "test iptal", ADMIN);
  let errD: string | null = null;
  try {
    await sub.executeDirectShip({ dispatchId: dispDId, reason: "iptal edilmiş sevk denemesi", customerId: CUSTOMER }, ADMIN);
  } catch (e) {
    errD = e instanceof Error ? e.message : String(e);
  }
  check("İptal edilmiş sevk doğrudan sevk edilemedi (hata)", errD !== null, errD ?? "(hata yok!)");

  // ===========================================================================
  // TEST E — Guard: customerId YOK → 400 "müşteri zorunludur" (07fbbde sözleşmesi)
  // ===========================================================================
  console.log("\n=== TEST E: Guard — customerId yok → müşteri zorunludur ===");
  const { woId: woE, stepIds: stepsE } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
  const r6 = await stockRoll(100);
  const dispE = await sub.dispatch({ workOrderId: woE, stepId: stepsE[0], subcontractorId: SUB_BOYER, rollIds: [r6] }, ADMIN);
  let errE: string | null = null;
  try {
    await sub.executeDirectShip({ dispatchId: (dispE.data as { id: string }).id, reason: "müşterisiz doğrudan sevk denemesi" }, ADMIN);
  } catch (e) {
    errE = e instanceof Error ? e.message : String(e);
  }
  check("customerId olmadan reddedildi ('müşteri zorunludur')", errE !== null && errE.includes("müşteri zorunludur"), errE ?? "(hata yok!)");
  // Guard dispatch lookup'tan önce → hiçbir mutasyon olmamalı.
  const r6a = await prisma.roll.findUnique({ where: { id: r6 }, select: { status: true } });
  check("Guard sonrası top hâlâ AT_SUBCONTRACTOR (mutasyon yok)", r6a?.status === RollStatus.AT_SUBCONTRACTOR, String(r6a?.status));

  console.log(`\n──────────────────────────────────────────`);
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: allStepIds } },
          { producedInStepId: { in: allStepIds } },
          { parentReceipt: { workOrderId: { in: createdWoIds } } },
          { barcode: { startsWith: "TST-DS-" } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    const directShipments = await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } });
    const directShipmentIds = directShipments.map((d) => d.id);
    const orderLines = await prisma.orderLine.findMany({ where: { orderId: { in: createdOrderIds } }, select: { id: true } });
    const orderLineIds = orderLines.map((l) => l.id);

    // Direct-ship irsaliyesinin sourceId'si DirectShipment.id — her iki kaynağı da sil.
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...directShipmentIds] } } });
    // DirectShipment sökümü: önce roll bağını çöz, sonra allocation, sonra kayıt
    // (DirectShipment.dispatchId Restrict → dispatch'ten ÖNCE silinmeli).
    await prisma.roll.updateMany({ where: { directShipment: { dispatchId: { in: dispatchIds } } }, data: { directShipmentId: null } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.directShipment.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.orderLine.deleteMany({ where: { id: { in: orderLineIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds, ...createdOrderIds] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
