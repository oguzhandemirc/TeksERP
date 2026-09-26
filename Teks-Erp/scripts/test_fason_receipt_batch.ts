// =============================================================================
// TEST: fason kabulünde doğan topların PARTİSİ (hareket defteri D8 R5b)
// Çalıştır: npx tsx scripts/test_fason_receipt_batch.ts
// =============================================================================
// Aynı fason adımına iki ayrı parti sevk edilir (A önce, B sonra); tek kabul iki partinin topunu
// birden döndürür:
//   §1 parti seçilmezse doğan toplar EN ESKİ açık sevkin partisini (A) alır — sıralamasız ilk bulunan değil
//   §2 istemci B'yi seçerse doğan toplar B'de doğar
//   §3 kabulün açık sevklerinden olmayan parti 400 RECEIPT_BATCH_NOT_OPEN; hiçbir şey yazılmaz
// NEGATİF SONDA (elle, 2026-09-26): açık sevk sorgusunun sıralaması ters çevrilince §1 kırmızı;
// seçim doğrulaması kaldırılınca §3 kırmızı. Yedek kopyadan geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestAdmin } from "./fixture-test-user";

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const TAG = `TST-FRB-${Date.now()}`;

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_BOYA = "", ST_TAMBUR = "", SUB_BOYER = "", GRADE = "", GRADE_CODE = "";
const woIds: string[] = [];
let seq = 0;

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Fikstür eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v;
  };
  ITEM = need(await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  const g = await roleGrade("FIRST");
  GRADE = g.id;
  GRADE_CODE = g.code;
}

async function top(): Promise<string> {
  seq += 1;
  const r = await prisma.roll.create({
    data: {
      barcode: `${TAG}-${seq}`, itemId: ITEM, initialQty: 200, currentQty: 200, status: RollStatus.STOCK,
      warehouseId: await fixtureWarehouseId(), qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: 250, createdById: ADMIN,
    },
    select: { id: true },
  });
  return r.id;
}

/** İş emri + aynı boyahane adımına iki ayrı sevk (A önce, B sonra), her birinde bir top. */
async function kur(): Promise<{ wo: string; step: string; a: string; b: string; batchA: string; batchB: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-${woIds.length + 1}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 250, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" }, { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" }] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const step = wo.steps[0].id;
  const [a, b] = [await top(), await top()];
  const batchOf = async (rollIds: string[]) => {
    const d = await sub.dispatch({ workOrderId: wo.id, stepId: step, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    return (await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: (d.data as { id: string }).id }, select: { batchId: true } })).batchId as string;
  };
  const batchA = await batchOf([a]);
  const batchB = await batchOf([b]);
  return { wo: wo.id, step, a, b, batchA, batchB };
}

async function kabul(k: { wo: string; step: string; a: string; b: string }, batchId?: string) {
  return sub.receive(
    { workOrderId: k.wo, stepId: k.step, subcontractorId: SUB_BOYER, returns: [{ rollId: k.a }, { rollId: k.b }], newRolls: [{ qty: 390 }], ...(batchId ? { batchId } : {}) },
    ADMIN,
  );
}

const dogan = async (receiptId: string) =>
  prisma.roll.findMany({ where: { parentReceiptId: receiptId }, select: { batchId: true } });

async function main(): Promise<void> {
  console.log("=== Fason kabulünde doğan topun partisi ===");
  await fikstur();
  try {
    const k1 = await kur();
    const r1 = await kabul(k1);
    const d1 = await dogan((r1.data as { id: string }).id);
    check("§1 seçim yok: doğan toplar en eski açık sevkin partisinde (A)", d1.length > 0 && d1.every((r) => r.batchId === k1.batchA), `${d1.length} top`);

    const k2 = await kur();
    const r2 = await kabul(k2, k2.batchB);
    const d2 = await dogan((r2.data as { id: string }).id);
    check("§2 seçilen parti (B): doğan toplar B'de", d2.length > 0 && d2.every((r) => r.batchId === k2.batchB), `${d2.length} top`);

    const k3 = await kur();
    const yabanci = k1.batchA;
    const hata = await kabul(k3, yabanci).then(() => null, (e: { statusCode?: number; details?: { code?: string } }) => e);
    const makbuz = await prisma.subcontractorReceipt.count({ where: { workOrderId: k3.wo } });
    check("§3 açık sevklerden olmayan parti: 400 RECEIPT_BATCH_NOT_OPEN, makbuz yok",
      hata?.statusCode === 400 && hata.details?.code === "RECEIPT_BATCH_NOT_OPEN" && makbuz === 0, `${hata?.statusCode} ${hata?.details?.code} · makbuz ${makbuz}`);
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((s) => s.id);
  const rollIds = (await prisma.roll.findMany({
    where: { OR: [{ barcode: { startsWith: TAG } }, { parentReceipt: { workOrderId: { in: woIds } } }, { producedInStepId: { in: stepIds } }] },
    select: { id: true },
  })).map((r) => r.id);
  const receiptIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((r) => r.id);
  const dispatchIds = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((d) => d.id);
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
  await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
