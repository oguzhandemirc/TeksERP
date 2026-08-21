// TEST: Çoklu sevkte (aynı fason adımına iki ayrı parti) KABUL parti gruplaması.
//
// Senaryo: Boyahane adımına parti-1 (2 top) sevk edilir, sonra parti-2 (3 top)
// sevk edilir. İki sevk boyahanede BİRLEŞMEZ. Kabul ekranı partileri AYRI
// göstermeli ki operatör "ikisi birlikte mi geldi, tek parti mi?" teyit edebilsin.
// Her parti kabul edilince AYRI bir SubcontractorReceipt (fiş) doğmalı ve doğan
// açık kumaş, kaynak partinin batchId (parti) lane'ini kalıtmalı.
//
// Rota: [1] Boyahane (Fason) → [2] Tambur (internal)
//
// Çalıştır: npx ts-node scripts/test_fason_parti_grouping.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";

// Fixture id'leri seed'den runtime'da çözülür (re-seed sonrası hardcoded id kırılırdı).
let ITEM = "";
let GRADE = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_TAMBUR = "";
let SUB_BOYER = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
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
  await resolveFixtures();
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-PG-${stamp}`,
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
  console.log(`\nİş emri: ${wo.workOrderNumber}  Rota: [1] Boyahane → [2] Tambur\n`);

  // ── PARTİ 1: 2 top → Boyahane ──
  const r1 = await stockRoll(300);
  const r2 = await stockRoll(300);
  const d1 = await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1, r2] },
    ADMIN,
  );
  const d1id = (d1.data as Any).id as string;
  // Parti lane = sevkin partisi (SubcontractorDispatch.batchId → Batch). Eski
  // batchSplitId=dispatch.id yerine artık dispatch bir Batch'e bağlı ve rollara batchId yazar.
  const lane1 = (await prisma.subcontractorDispatch.findUnique({ where: { id: d1id }, select: { batchId: true } }))!.batchId;
  console.log(`Parti-1 sevk: ${(d1.data as Any).dispatchNo} (2 top, parti=${lane1.slice(0, 8)})`);

  // ── PARTİ 2: 3 top → AYNI Boyahane adımı (çoklu sevk) ──
  const r3 = await stockRoll(200);
  const r4 = await stockRoll(200);
  const r5 = await stockRoll(200);
  const d2 = await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r3, r4, r5] },
    ADMIN,
  );
  const d2id = (d2.data as Any).id as string;
  const lane2 = (await prisma.subcontractorDispatch.findUnique({ where: { id: d2id }, select: { batchId: true } }))!.batchId;
  console.log(`Parti-2 sevk: ${(d2.data as Any).dispatchNo} (3 top, parti=${lane2.slice(0, 8)})\n`);

  check("İki sevk farklı parti (batchId) üretti", lane1 !== lane2);

  // Topların batchId'si (partisi) sevkin partisine eşit mi?
  const rollLanes = await prisma.roll.findMany({
    where: { id: { in: [r1, r2, r3, r4, r5] } },
    select: { id: true, batchId: true },
  });
  const laneOf = (id: string) => rollLanes.find((r) => r.id === id)!.batchId;
  check("Parti-1 topları parti1 taşıyor", laneOf(r1) === lane1 && laneOf(r2) === lane1);
  check("Parti-2 topları parti2 taşıyor", [r3, r4, r5].every((id) => laneOf(id) === lane2));

  // ── KABUL GRUPLAMA: WO-flow (refakat kartı akışı) ──
  console.log("KABUL GRUPLAMA — listPendingReturns(workOrderId)");
  const woFlow = await sub.listPendingReturns({ workOrderId: woId });
  const groups = woFlow.data as Any[];
  check("Tek fason adım grubu döndü", groups.length === 1, `grup=${groups.length}`);
  const g = groups[0];
  check("Grupta 2 PARTİ var (sevkler ayrıştı)", g.parties?.length === 2, `parti=${g.parties?.length}`);
  // Sıralama: parti-1 (önce sevk) en üstte
  check("parties[0] = Parti-1 (sevk tarihine göre artan)", g.parties?.[0]?.dispatchId === d1id, g.parties?.[0]?.dispatchNo);
  check("Parti-1 rollCount = 2", g.parties?.[0]?.rollCount === 2, `${g.parties?.[0]?.rollCount}`);
  check("Parti-2 rollCount = 3", g.parties?.[1]?.rollCount === 3, `${g.parties?.[1]?.rollCount}`);
  check(
    "Parti rolls per-roll batchId (parti) taşıyor",
    g.parties?.[0]?.rolls?.every((r: Any) => r.batchId === lane1),
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
    select: { id: true, batchId: true, currentStepId: true, status: true },
  });
  check("Parti-1 doğan açık kumaş parti1 kalıttı", born1?.batchId === lane1, `${born1?.batchId?.slice(0, 8)}`);
  check("Parti-1 doğan top Tambur'da IN_PRODUCTION", born1?.currentStepId === tamburStep && born1?.status === RollStatus.IN_PRODUCTION);

  // Boyahane adımı HÂLÂ ACTIVE (Parti-2 dönmedi)
  const boyaAfter1 = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
  check("Parti-1 kabulünde Boyahane HÂLÂ ACTIVE (Parti-2 bekliyor)", boyaAfter1?.status === StepStatus.ACTIVE, String(boyaAfter1?.status));

  // Pending tekrar → yalnız Parti-2 kaldı
  const detail2 = (await sub.getPendingReturnGroupDetail(boyaStep)).data as Any;
  check("Parti-1 kabulünden sonra pending'de tek parti kaldı", detail2.parties?.length === 1, `parti=${detail2.parties?.length}`);
  check("Kalan parti = Parti-2 (3 top)", detail2.parties?.[0]?.dispatchId === d2id && detail2.parties?.[0]?.rollCount === 3);

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
    select: { id: true, batchId: true },
  });
  check("Parti-2 doğan açık kumaş parti2 kalıttı", born2?.batchId === lane2, `${born2?.batchId?.slice(0, 8)}`);
  check("İki doğan top FARKLI parti taşıyor", born1?.batchId !== born2?.batchId);

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
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.batch.deleteMany({ where: { workOrderId: woId } });
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
