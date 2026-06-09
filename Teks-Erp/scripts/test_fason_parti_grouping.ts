// TEST: Çoklu sevkte (aynı fason adımına iki ayrı parti) KABUL parti gruplaması.
//
// Senaryo: Boyahane adımına parti-1 (2 top) sevk edilir, sonra parti-2 (3 top)
// sevk edilir. İki sevk boyahanede BİRLEŞMEZ. Kabul ekranı partileri AYRI
// göstermeli ki operatör "ikisi birlikte mi geldi, tek parti mi?" teyit edebilsin.
// Her parti kabul edilince AYRI bir SubcontractorReceipt (fiş) doğmalı ve doğan
// açık kumaş, kaynak partinin batchSplitId lane'ini kalıtmalı.
//
// Rota: [1] Boyahane (Fason) → [2] Tambur (internal)
//
// Çalıştır: npx ts-node scripts/test_fason_parti_grouping.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";

const ITEM = "9d49919d-b1d7-4e06-bb68-f55c5fb09911"; // PATOS
const GRADE = "a1b5b3e1-e899-4ac3-9d57-b329491056b1"; // 1.KALITE
const ADMIN = "ff0baa78-8a0f-469e-8f1a-437efb3d4499";
const ST_BOYA = "9254a500-68ff-4b88-af15-0e3182e3b14e"; // Boyahane (Fason)
const ST_TAMBUR = "42270197-9e09-4984-a80f-703df2beec2e"; // Tambur
const SUB_BOYER = "f83bcbf5-1f59-4eef-953d-fd4526c5c070"; // Boyer Boyacılık
const WIDTH = 250;

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
  return `TST-PG-${rand}${bc}`;
}

async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      qualityGrade: "1.KALITE",
      qualityGradeId: GRADE,
      width: WIDTH,
      createdById: ADMIN,
    },
  });
  return r.id;
}

let woId = "";
const stepIds: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function main(): Promise<void> {
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-PG-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 2000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const boyaStep = wo.steps[0].id;
  const tamburStep = wo.steps[1].id;
  stepIds.push(boyaStep, tamburStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  console.log(`\nİş emri: ${wo.batchNumber}  Rota: [1] Boyahane → [2] Tambur\n`);

  // ── PARTİ 1: 2 top → Boyahane ──
  const r1 = await stockRoll(300);
  const r2 = await stockRoll(300);
  const d1 = await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1, r2] },
    ADMIN,
  );
  const lane1 = (d1.data as Any).id as string;
  console.log(`Parti-1 sevk: ${(d1.data as Any).dispatchNo} (2 top, lane=${lane1.slice(0, 8)})`);

  // ── PARTİ 2: 3 top → AYNI Boyahane adımı (çoklu sevk) ──
  const r3 = await stockRoll(200);
  const r4 = await stockRoll(200);
  const r5 = await stockRoll(200);
  const d2 = await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r3, r4, r5] },
    ADMIN,
  );
  const lane2 = (d2.data as Any).id as string;
  console.log(`Parti-2 sevk: ${(d2.data as Any).dispatchNo} (3 top, lane=${lane2.slice(0, 8)})\n`);

  check("İki sevk farklı lane (batchSplitId) üretti", lane1 !== lane2);

  // Topların batchSplitId'si sevkin id'sine eşit mi?
  const rollLanes = await prisma.roll.findMany({
    where: { id: { in: [r1, r2, r3, r4, r5] } },
    select: { id: true, batchSplitId: true },
  });
  const laneOf = (id: string) => rollLanes.find((r) => r.id === id)!.batchSplitId;
  check("Parti-1 topları lane1 taşıyor", laneOf(r1) === lane1 && laneOf(r2) === lane1);
  check("Parti-2 topları lane2 taşıyor", [r3, r4, r5].every((id) => laneOf(id) === lane2));

  // ── KABUL GRUPLAMA: WO-flow (refakat kartı akışı) ──
  console.log("KABUL GRUPLAMA — listPendingReturns(workOrderId)");
  const woFlow = await sub.listPendingReturns({ workOrderId: woId });
  const groups = woFlow.data as Any[];
  check("Tek fason adım grubu döndü", groups.length === 1, `grup=${groups.length}`);
  const g = groups[0];
  check("Grupta 2 PARTİ var (sevkler ayrıştı)", g.parties?.length === 2, `parti=${g.parties?.length}`);
  // Sıralama: parti-1 (önce sevk) en üstte
  check("parties[0] = Parti-1 (sevk tarihine göre artan)", g.parties?.[0]?.dispatchId === lane1, g.parties?.[0]?.dispatchNo);
  check("Parti-1 rollCount = 2", g.parties?.[0]?.rollCount === 2, `${g.parties?.[0]?.rollCount}`);
  check("Parti-2 rollCount = 3", g.parties?.[1]?.rollCount === 3, `${g.parties?.[1]?.rollCount}`);
  check(
    "Parti rolls per-roll batchSplitId taşıyor",
    g.parties?.[0]?.rolls?.every((r: Any) => r.batchSplitId === lane1),
  );
  check("Parti-1 dispatchNo dolu", typeof g.parties?.[0]?.dispatchNo === "string" && g.parties[0].dispatchNo.length > 0);
  check("Parti-1 subcontractor dolu (Boyer)", g.parties?.[0]?.subcontractor?.id === SUB_BOYER);

  // ── KABUL GRUPLAMA: detail (lazy-load) — stepId bazlı ──
  console.log("\nKABUL GRUPLAMA — getPendingReturnGroupDetail(stepId)");
  const detailRes = await sub.getPendingReturnGroupDetail(boyaStep);
  const detail = detailRes.data as Any;
  check("Detayda da 2 parti var", detail.parties?.length === 2, `parti=${detail.parties?.length}`);
  check("Detay parti-1 rollCount=2, parti-2 rollCount=3",
    detail.parties?.[0]?.rollCount === 2 && detail.parties?.[1]?.rollCount === 3);

  // ── HER PARTİ AYRI FİŞ: sadece Parti-1'i kabul et ──
  console.log("\nKABUL — yalnız Parti-1 (3 toptan 2'si geldi senaryosu)");
  const rc1 = await sub.receive(
    {
      workOrderId: woId,
      stepId: boyaStep,
      subcontractorId: SUB_BOYER,
      returns: [{ rollId: r1 }, { rollId: r2 }],
      newRolls: [{ qty: 580 }],
    },
    ADMIN,
  );
  const receipt1 = rc1.data as Any;
  check("Parti-1 fişi oluştu", typeof receipt1?.receiptNo === "string");

  const born1 = await prisma.roll.findFirst({
    where: { parentReceiptId: receipt1.id },
    select: { id: true, batchSplitId: true, currentStepId: true, status: true },
  });
  check("Parti-1 doğan açık kumaş lane1 kalıttı", born1?.batchSplitId === lane1, `${born1?.batchSplitId?.slice(0, 8)}`);
  check("Parti-1 doğan top Tambur'da IN_PRODUCTION", born1?.currentStepId === tamburStep && born1?.status === RollStatus.IN_PRODUCTION);

  // Boyahane adımı HÂLÂ ACTIVE (Parti-2 dönmedi)
  const boyaAfter1 = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
  check("Parti-1 kabulünde Boyahane HÂLÂ ACTIVE (Parti-2 bekliyor)", boyaAfter1?.status === StepStatus.ACTIVE, String(boyaAfter1?.status));

  // Pending tekrar → yalnız Parti-2 kaldı
  const detail2 = (await sub.getPendingReturnGroupDetail(boyaStep)).data as Any;
  check("Parti-1 kabulünden sonra pending'de tek parti kaldı", detail2.parties?.length === 1, `parti=${detail2.parties?.length}`);
  check("Kalan parti = Parti-2 (3 top)", detail2.parties?.[0]?.dispatchId === lane2 && detail2.parties?.[0]?.rollCount === 3);

  // ── Parti-2'yi kabul et — AYRI fiş ──
  console.log("\nKABUL — Parti-2 (ayrı fiş)");
  const rc2 = await sub.receive(
    {
      workOrderId: woId,
      stepId: boyaStep,
      subcontractorId: SUB_BOYER,
      returns: [{ rollId: r3 }, { rollId: r4 }, { rollId: r5 }],
      newRolls: [{ qty: 560 }],
    },
    ADMIN,
  );
  const receipt2 = rc2.data as Any;
  check("Parti-2 fişi oluştu", typeof receipt2?.receiptNo === "string");
  check("İki AYRI fiş (her parti ayrı receipt)", receipt1.id !== receipt2.id && receipt1.receiptNo !== receipt2.receiptNo);

  const born2 = await prisma.roll.findFirst({
    where: { parentReceiptId: receipt2.id },
    select: { id: true, batchSplitId: true },
  });
  check("Parti-2 doğan açık kumaş lane2 kalıttı", born2?.batchSplitId === lane2, `${born2?.batchSplitId?.slice(0, 8)}`);
  check("İki doğan top FARKLI lane taşıyor", born1?.batchSplitId !== born2?.batchSplitId);

  // Boyahane artık COMPLETED
  const boyaAfter2 = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
  check("Her iki parti kabulünden sonra Boyahane COMPLETED", boyaAfter2?.status === StepStatus.COMPLETED, String(boyaAfter2?.status));

  // Fiş içerik sayıları
  const items1 = await prisma.subcontractorReceiptItem.count({ where: { receiptId: receipt1.id } });
  const items2 = await prisma.subcontractorReceiptItem.count({ where: { receiptId: receipt2.id } });
  check("Parti-1 fişinde 2 orijinal top", items1 === 2, `${items1}`);
  check("Parti-2 fişinde 3 orijinal top", items2 === 3, `${items2}`);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
          { parentReceipt: { workOrderId: woId } },
          { barcode: { startsWith: "TST-PG-" } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);

    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, woId] } } });
    await prisma.workOrder.delete({ where: { id: woId } });
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
