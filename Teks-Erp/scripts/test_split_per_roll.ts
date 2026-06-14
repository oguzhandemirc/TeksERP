// TEST: Per-roll split — fasondaki 2 toptan SADECE BİRİNİ yeni iş emrine ayır.
//
// Senaryo: Rota KK1 → Boyahane(renk) → Tambur. Bir dispatch'te 2 top boyahanede
// (AT_SUBCONTRACTOR). Bunlardan SADECE biri yeni renkle yeni WO'ya ayrılır; diğeri
// orijinal WO'da kalır. Taşınan top için YENİ dispatch (lane) açılır; orijinal sevk
// kalan toplarla kaynak WO'da kalır.
//
// Çalıştır: npx tsx scripts/test_split_per_roll.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_TAMBUR = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`fixture eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "grade");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
}

const sub = new SubcontractorService();
const wos = new WorkOrderService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
let bc = 0;
const barcode = () => `TST-SPR-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc++}`;
async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const woIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  const dye = await prisma.subcontractorCategory.findFirst({ where: { appliesColor: true }, select: { id: true } });
  if (!dye) throw new Error("appliesColor kategori yok");
  const link = await prisma.subcontractorToCategory.findFirst({ where: { categoryId: dye.id }, select: { subcontractorId: true } });
  if (!link) throw new Error("renk veren firma yok");
  const SUB = link.subcontractorId;
  const kk1 = await prisma.station.findFirst({ where: { kind: "RAW_QC" }, select: { id: true } });
  if (!kk1) throw new Error("KK1 yok");
  const colors = await prisma.color.findMany({ where: { isActive: true }, take: 2, select: { id: true, name: true } });
  if (colors.length < 2) throw new Error("2 renk gerekli");
  const colorB = colors[1];

  // Kaynak WO + bir dispatch'te 2 top boyahanede.
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-SPR-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM, targetColorId: colors[0].id,
      steps: { create: [
        { stationId: kk1.id, stepSequence: 1, status: "PENDING" },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", requiredCategoryId: dye.id },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  const srcBoya = wo.steps[1].id;
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  const r1 = await stockRoll(300), r2 = await stockRoll(300);
  const d = await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: [r1, r2] }, ADMIN);
  const lane = (d.data as Any).id as string;
  console.log(`\nDispatch lane=${lane.slice(0, 8)} (2 top: r1, r2)\n`);

  // Önizleme: 2 top görünür.
  const prev = (await wos.getSplitPreview(wo.id, lane)).data as Any;
  check("Preview: 2 top listelenir", prev.rollCount === 2, `${prev.rollCount}`);
  check("Preview: mod continue", prev.mode === "continue", prev.mode ?? "null");

  // SADECE r1'i ayır.
  const res = (await wos.splitBranch(wo.id, { batchSplitId: lane, newColorId: colorB.id, orderMode: "stock", rollIds: [r1] }, ADMIN)).data as Any;
  const newWoId = res.newWorkOrderId as string;
  woIds.push(newWoId);
  check("Split: yeni WO oluştu", typeof newWoId === "string" && newWoId !== wo.id);
  check("Split: SADECE 1 top taşındı", res.movedRollCount === 1, `${res.movedRollCount}`);

  // r1 → yeni WO, yeni dispatch (lane ≠ orijinal), AT_SUBCONTRACTOR.
  const r1a = await prisma.roll.findUnique({ where: { id: r1 }, select: { status: true, batchSplitId: true, currentStep: { select: { workOrderId: true } } } });
  check("r1 AT_SUBCONTRACTOR (boyahanede)", r1a?.status === RollStatus.AT_SUBCONTRACTOR, String(r1a?.status));
  check("r1 YENİ WO'da", r1a?.currentStep?.workOrderId === newWoId, String(r1a?.currentStep?.workOrderId));
  check("r1 YENİ lane (batchSplitId ≠ orijinal)", !!r1a?.batchSplitId && r1a.batchSplitId !== lane, String(r1a?.batchSplitId));

  // r2 → kaynak WO'da, orijinal lane'de, AT_SUBCONTRACTOR.
  const r2a = await prisma.roll.findUnique({ where: { id: r2 }, select: { status: true, batchSplitId: true, currentStep: { select: { workOrderId: true } } } });
  check("r2 hâlâ AT_SUBCONTRACTOR", r2a?.status === RollStatus.AT_SUBCONTRACTOR, String(r2a?.status));
  check("r2 KAYNAK WO'da kaldı", r2a?.currentStep?.workOrderId === wo.id, String(r2a?.currentStep?.workOrderId));
  check("r2 ORİJİNAL lane'de", r2a?.batchSplitId === lane, String(r2a?.batchSplitId));

  // Yeni WO rengi B; yeni dispatch r1'i içerir, orijinal dispatch r2'yi.
  const newWo = await prisma.workOrder.findUnique({ where: { id: newWoId }, select: { targetColorId: true } });
  check("Yeni WO targetColor = Renk B", newWo?.targetColorId === colorB.id);
  const newDispatch = await prisma.subcontractorDispatch.findFirst({ where: { id: r1a!.batchSplitId! }, select: { workOrderId: true, items: { select: { rollId: true } } } });
  check("Yeni dispatch yeni WO'ya ait + r1'i içerir", newDispatch?.workOrderId === newWoId && newDispatch.items.length === 1 && newDispatch.items[0].rollId === r1);
  const origItems = await prisma.subcontractorDispatchItem.findMany({ where: { dispatchId: lane }, select: { rollId: true } });
  check("Orijinal dispatch yalnız r2'yi tutar", origItems.length === 1 && origItems[0].rollId === r2, `${origItems.length} kalem`);

  // Kaynak boyahane adımı hâlâ ACTIVE (r2 orada).
  const srcStep = await prisma.workOrderStep.findUnique({ where: { id: srcBoya }, select: { status: true } });
  check("Kaynak boyahane adımı ACTIVE (r2 bekliyor)", srcStep?.status === StepStatus.ACTIVE, String(srcStep?.status));

  console.log(`\n──────────────────────────────────────────`);
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchSplitId: { in: dispatchIds } }, { barcode: { startsWith: "TST-SPR-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...dispatchIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
