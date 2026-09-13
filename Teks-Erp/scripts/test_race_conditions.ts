// =============================================================================
// TEST: Race-condition sertleştirme (feat/race-condition-hardening)
// Çalıştır: npx tsx scripts/test_race_conditions.ts
// =============================================================================
// Kapsam:
//   A) Birim — yeni kilit yardımcıları (DB GEREKMEZ, sahte tx):
//        touchOrderLinesTx  → ID'ler SIRALI + dedup + id başına updateMany
//        touchWorkOrderTx    → tek workOrder.updateMany (satır write-kilidi)
//   B) Entegrasyon — fason directShip OVER-COVERAGE yarışı (subcon #2/#5):
//        Aynı sipariş satırına (quantity=100) iki paralel directShip (her biri 80)
//        → eski kodda shippedQty=160 (over-cover); fix'te biri 409, toplam ≤ 100.
//   C) Entegrasyon — fason completion yarışı (subcon #4):
//        Eşzamanlı receive(D1) + dispatch(D2 yeni parti) → WO COMPLETED ise adımda
//        AT_SUBCONTRACTOR top KALMAMALI (mal fasonda + WO kapalı = stranded yasak).
//   D) Entegrasyon — DSK shipmentNo yarışı + directShippedAt claim:
//        Aynı dispatch'e çifte executeDirectShip → tek DirectShipment, top tek kez
//        consumed; kaybeden zarif 409 (ya da tx-öncesi idempotent-cached) — P2002
//        ('shipmentNo' unique) DIŞARI SIZMAZ (withBarcodeRetry tam-tx retry).
//
// Not: #1 (çuval re-parent guarded claim), #3 (relabel TOCTOU), çapraz-sevkiyat
// markReady over-cover happy-path'leri mevcut sack/relabel/retarget suite'lerinde;
// burada en yüksek-riskli veri-bozan yol (over-cover) deterministik kanıtlanır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { touchOrderLinesTx } from "../src/services/helpers/order-status.helper";
import { touchWorkOrderTx } from "../src/services/helpers/workorder-locks.helper";
import { AppError } from "../src/utils/app-error";
import { RollStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

// ── A) BİRİM: yeni kilit yardımcıları (sahte tx) ─────────────────────────────
async function testHelpers(): Promise<void> {
  console.log("\n=== A) Birim: kilit yardımcıları (DB yok) ===");

  // touchOrderLinesTx: girişi karışık + duplikatlı → çıkış SIRALI + dedup, id başına 1 çağrı
  {
    const calls: string[] = [];
    const fakeTx = {
      orderLine: { updateMany: async (a: { where: { id: string } }) => { calls.push(a.where.id); return { count: 1 }; } },
    } as unknown as Parameters<typeof touchOrderLinesTx>[0];
    await touchOrderLinesTx(fakeTx, ["c", "a", "b", "a", "c"]);
    check("touchOrderLinesTx: dedup + SIRALI kilit", JSON.stringify(calls) === JSON.stringify(["a", "b", "c"]), JSON.stringify(calls));
    check("touchOrderLinesTx: id başına ayrı updateMany (Promise.all değil)", calls.length === 3);
  }
  // boş giriş → hiç çağrı yok
  {
    let n = 0;
    const fakeTx = {
      orderLine: { updateMany: async () => { n++; return { count: 0 }; } },
    } as unknown as Parameters<typeof touchOrderLinesTx>[0];
    await touchOrderLinesTx(fakeTx, []);
    check("touchOrderLinesTx: boş giriş → çağrı yok", n === 0);
  }
  // touchWorkOrderTx: tek updateMany, where.id doğru
  {
    const calls: { id: unknown }[] = [];
    const fakeTx = {
      workOrder: { updateMany: async (a: { where: { id: string } }) => { calls.push({ id: a.where.id }); return { count: 1 }; } },
    } as unknown as Parameters<typeof touchWorkOrderTx>[0];
    await touchWorkOrderTx(fakeTx, "wo-1");
    check("touchWorkOrderTx: tek updateMany + where.id", calls.length === 1 && calls[0].id === "wo-1");
  }
}

// ── Entegrasyon fixture'ları (business-key; TEST- prefix) ────────────────────
const sub = new SubcontractorService();
const cards = new TravelerCardService();
let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", SUB_BOYER = "", CUSTOMER = "";
let GRADE_CODE = "";
const WIDTH = 250;
const woIds: string[] = [], orderIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-RACE-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
}

async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}
async function makeWoBoya(): Promise<{ woId: string; stepId: string }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TST-RACE-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM, steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" as const }] } },
    include: { steps: true },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepId: wo.steps[0].id };
}
async function makeOrderLine(qty: number): Promise<string> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const order = await prisma.order.create({ data: { orderNumber: `TST-RACE-ORD-${stamp}`, customerId: CUSTOMER, status: "APPROVED", lines: { create: [{ itemId: ITEM, colorId: null, width: WIDTH, quantity: qty }] } }, include: { lines: true } });
  orderIds.push(order.id); return order.lines[0].id;
}
async function dispatchRoll(woId: string, stepId: string, rollId: string): Promise<string> {
  const d = await sub.dispatch({ workOrderId: woId, stepId, subcontractorId: SUB_BOYER, rollIds: [rollId] }, ADMIN);
  return (d.data as { id: string }).id;
}

// ── B) Entegrasyon: directShip OVER-COVERAGE yarışı ──────────────────────────
async function testOverCoverageRace(): Promise<void> {
  console.log("\n=== B) directShip over-coverage yarışı (subcon #2) ===");
  // Tek sipariş satırı quantity=100. İki ayrı WO/dispatch, her biri 80 karşılamak istiyor.
  const lineId = await makeOrderLine(100);
  const a = await makeWoBoya(); const ra = await stockRoll(80); const dA = await dispatchRoll(a.woId, a.stepId, ra);
  const b = await makeWoBoya(); const rb = await stockRoll(80); const dB = await dispatchRoll(b.woId, b.stepId, rb);

  const results = await Promise.allSettled([
    sub.executeDirectShip({ dispatchId: dA, reason: "race A", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: lineId, qty: 80 }] }, ADMIN),
    sub.executeDirectShip({ dispatchId: dB, reason: "race B", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: lineId, qty: 80 }] }, ADMIN),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  const line = await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true, quantity: true } });
  const shipped = Number(line?.shippedQty);

  check("over-cover: tam BİRİ kazandı (diğeri reddedildi)", fulfilled === 1 && rejected === 1, `fulfilled=${fulfilled} rejected=${rejected}`);
  // Kaybeden sözleşmesi: ZARİF 409 (AppError) — DSK shipmentNo yarışının P2002'si
  // dışarı SIZMAMALI (withBarcodeRetry tx'i baştan dener, kaybeden tx-içi atomik
  // guard'lardan birine — burada satır-kilidi altındaki cap'e — takılır).
  const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  const loserErr: unknown = loser?.reason;
  const loserDesc = loserErr instanceof Error ? `${loserErr.constructor.name}(${(loserErr as AppError).statusCode ?? "-"}): ${loserErr.message}` : String(loserErr);
  check("over-cover: kaybeden zarif 409 aldı (P2002 sızmadı)", loserErr instanceof AppError && loserErr.statusCode === 409, loserDesc);
  const winner = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof sub.executeDirectShip>>> | undefined;
  const winnerNo = (winner?.value.data as { directShipmentNo?: string } | undefined)?.directShipmentNo;
  check("over-cover: kazanan DSK'lı DirectShipment üretti", typeof winnerNo === "string" && winnerNo.startsWith("DSK"), `directShipmentNo=${winnerNo}`);
  check("over-cover: shippedQty quantity'yi AŞMADI (≤100)", shipped <= 100, `shippedQty=${shipped}`);
  check("over-cover: kazanan tam 80 yazdı", shipped === 80, `shippedQty=${shipped}`);
}

// ── D) Entegrasyon: DSK shipmentNo yarışı — aynı dispatch çifte-ateş ─────────
async function testShipmentNoRace(): Promise<void> {
  console.log("\n=== D) directShip çifte-ateş: aynı dispatch, tek DSK + kaybeden 409/idempotent ===");
  const { woId, stepId } = await makeWoBoya();
  const rollId = await stockRoll(50);
  const dId = await dispatchRoll(woId, stepId, rollId);

  const results = await Promise.allSettled([
    sub.executeDirectShip({ dispatchId: dId, reason: "çifte-ateş 1", customerId: CUSTOMER }, ADMIN),
    sub.executeDirectShip({ dispatchId: dId, reason: "çifte-ateş 2", customerId: CUSTOMER }, ADMIN),
  ]);
  // Kaybeden sözleşmesi: ya tx-içi atomik claim'e (directShippedAt / AT_SUBCONTRACTOR
  // count) takılıp zarif 409, ya da tx-öncesi idempotency yolundan cached başarı
  // (alreadyDirectShipped) — ama ASLA P2002/çift sevk değil.
  const realWins = results.filter(
    (r) => r.status === "fulfilled" && !(r.value.data as { alreadyDirectShipped?: boolean }).alreadyDirectShipped,
  ).length;
  const gracefulLosses = results.filter(
    (r) =>
      (r.status === "rejected" && r.reason instanceof AppError && r.reason.statusCode === 409) ||
      (r.status === "fulfilled" && (r.value.data as { alreadyDirectShipped?: boolean }).alreadyDirectShipped === true),
  ).length;
  const descs = results.map((r) => (r.status === "rejected" ? `rejected(${r.reason instanceof AppError ? r.reason.statusCode : r.reason?.constructor?.name})` : "fulfilled")).join(", ");
  check("çifte-ateş: tam BİRİ gerçek sevk yaptı", realWins === 1, descs);
  check("çifte-ateş: kaybeden zarif (409 veya idempotent-cached)", gracefulLosses === 1, descs);

  const shipCount = await prisma.directShipment.count({ where: { dispatchId: dId } });
  check("çifte-ateş: dispatch için TEK DirectShipment", shipCount === 1, `count=${shipCount}`);
  const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true } });
  check("çifte-ateş: top tek kez SUBCONTRACTOR_CONSUMED", roll?.status === RollStatus.SUBCONTRACTOR_CONSUMED, `status=${roll?.status}`);
  const disp = await prisma.subcontractorDispatch.findUnique({ where: { id: dId }, select: { directShippedAt: true } });
  check("çifte-ateş: directShippedAt claim'i set", disp?.directShippedAt != null);
}

// ── C) Entegrasyon: fason completion yarışı (receive vs dispatch) ────────────
async function testFasonCompletionRace(): Promise<void> {
  console.log("\n=== C) Fason completion yarışı: receive(D1) || dispatch(D2) (subcon #4) ===");
  // Tek BOYA_FASON adımı (son adım). D1=[r1] sevk; sonra eşzamanlı: r1 kabul + r2 yeni parti sevk.
  const { woId, stepId } = await makeWoBoya();
  const r1 = await stockRoll(100);
  const dA = await dispatchRoll(woId, stepId, r1); // r1 → AT_SUBCONTRACTOR
  void dA;
  const r2 = await stockRoll(100); // serbest stok — dispatch D2 auto-attach edecek

  await Promise.allSettled([
    sub.receive({
      workOrderId: woId,
      stepId,
      subcontractorId: SUB_BOYER,
      returns: [{ rollId: r1 }],
      newRolls: [{ qty: 100 }],
    } as Parameters<typeof sub.receive>[0], ADMIN),
    sub.dispatch({ workOrderId: woId, stepId, subcontractorId: SUB_BOYER, rollIds: [r2] }, ADMIN),
  ]);

  const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
  const atSub = await prisma.roll.count({ where: { currentStepId: stepId, status: RollStatus.AT_SUBCONTRACTOR } });
  // İnvariant: WO COMPLETED ise fasonda bekleyen top OLMAMALI (stranded yasak).
  const ok = wo?.status !== "COMPLETED" || atSub === 0;
  check("fason completion: WO COMPLETED ⇒ AT_SUBCONTRACTOR top yok (stranded yasak)", ok, `wo=${wo?.status} atSub=${atSub}`);
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  // Skaler FK kolonlarıyla (ilişki-adı tahmini yok) çocuktan köke sil.
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const stepIdSet = steps.map((s) => s.id);
  const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const dispatchIds = dispatches.map((d) => d.id);
  // DirectShipment söküm sırası: alloc (directShipmentId FK) sil → roll FK'sını
  // boşalt → DirectShipment sil → ANCAK ONDAN SONRA dispatch silinebilir
  // (DirectShipment.dispatch onDelete: Restrict).
  const directShipments = await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } });
  const directShipmentIds = directShipments.map((s) => s.id);
  const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const receiptIds = receipts.map((r) => r.id);
  // Toplar: TST-RACE- barkodlular + adıma bağlılar + adımda üretilenler + receipt'ten doğanlar.
  const rolls = await prisma.roll.findMany({
    where: {
      OR: [
        { barcode: { startsWith: "TST-RACE-" } },
        { currentStepId: { in: stepIdSet } },
        { producedInStepId: { in: stepIdSet } },
        { parentReceiptId: { in: receiptIds } },
      ],
    },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  const orderLines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const orderLineIds = orderLines.map((l) => l.id);

  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
  await prisma.roll.updateMany({ where: { directShipmentId: { in: directShipmentIds } }, data: { directShipmentId: null } });
  await prisma.directShipment.deleteMany({ where: { id: { in: directShipmentIds } } });
  await prisma.subcontractorReceiptItem.deleteMany({ where: { OR: [{ receiptId: { in: receiptIds } }, { newRollId: { in: rollIds } }] } });
  await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { OR: [{ dispatchId: { in: dispatchIds } }, { rollId: { in: rollIds } }] } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds, ...directShipmentIds] } } });
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
  // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
  // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
  await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIdSet } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.orderLine.deleteMany({ where: { id: { in: orderLineIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
}

async function main(): Promise<void> {
  await testHelpers();
  await resolveFixtures();
  try {
    await testOverCoverageRace();
    await testShipmentNoRace();
    await testFasonCompletionRace();
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
