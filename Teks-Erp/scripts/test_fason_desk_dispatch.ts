// TEST: Masaüstü (planlama ekranı) fason sevki — bulkDispatchStep + transferToNextFason
//
// Saha isteği: "zımparadan boyahaneye top gidince planlama ekranından sevk edildi
// işaretlenebilsin." Top okutmadan, adımda bekleyen tüm topları planlı firmaya toplu
// sevk (bulkDispatchStep) + fasondan fasona doğrudan aktarım (transferToNextFason).
//
// Rota: [1] Zımpara (Fason) → [2] Boyahane (Fason) → [3] Tambur (internal)
//
// Çalıştır: npx tsx scripts/test_fason_desk_dispatch.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";

// Fixture id'leri seed'den runtime'da çözülür (business key ile bağla — re-seed güvenli).
let ITEM = "";
let GRADE = "";
let ADMIN = "";
let ST_ZIMPARA = "";
let ST_BOYA = "";
let ST_TAMBUR = "";
let SUB_KESTEL = "";
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
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "Station ZIMPARA_FASON");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
  SUB_KESTEL = need(await prisma.subcontractor.findFirst({ where: { code: "KESTEL" }, select: { id: true } }), "Subcontractor KESTEL");
  SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "Subcontractor BOYER");
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

/** Bir async çağrının Türkçe hata mesajıyla reddedildiğini doğrula. */
async function expectReject(label: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let msg: string | null = null;
  try {
    await fn();
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  check(label, msg !== null && msg.includes(needle), msg ?? "hata atılmadı (beklenen: " + needle + ")");
}

let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-FDD-${rand}${bc}`;
}

async function rollAtStep(qty: number, stepId: string): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.IN_PRODUCTION,
      currentStepId: stepId,
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

async function main(): Promise<void> {
  await resolveFixtures();
  const stamp = `${Date.now()}`.slice(-6);

  // ── 1) İş emri: zımpara (planlı firma YOK başta) → boyahane (planlı BOYER) → tambur
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-FDD-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", plannedSubcontractorId: SUB_BOYER },
          { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const zimparaStep = wo.steps[0].id;
  const boyaStep = wo.steps[1].id;
  const tamburStep = wo.steps[2].id;
  stepIds.push(zimparaStep, boyaStep, tamburStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  console.log(`\nİş emri: ${wo.workOrderNumber}`);
  console.log(`  Rota: [1] Zımpara → [2] Boyahane → [3] Tambur\n`);

  // 2 top zımpara adımında bekliyor (KK1 sonrası attach simülasyonu)
  const r1 = await rollAtStep(300, zimparaStep);
  const r2 = await rollAtStep(300, zimparaStep);

  // ── 2) GUARD: planlı firma yokken toplu sevk reddedilmeli ──
  console.log("GUARD: planlı firma yok");
  await expectReject(
    "Firma planlanmamış adımda toplu sevk reddedildi",
    () => sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep }, ADMIN),
    "Fason firma planlanmamış",
  );

  // ── 3) GUARD: internal (Tambur) adımda toplu sevk reddedilmeli ──
  await expectReject(
    "Internal adımda toplu sevk reddedildi",
    () => sub.bulkDispatchStep({ workOrderId: woId, stepId: tamburStep, subcontractorId: SUB_KESTEL }, ADMIN),
    "yalnızca fason",
  );

  // Zımpara adımına firma planla → resolution path test edilsin
  await prisma.workOrderStep.update({ where: { id: zimparaStep }, data: { plannedSubcontractorId: SUB_KESTEL } });

  // ── 4) HAPPY: bulkDispatchStep(zımpara) — firma planlıdan çözülür ──
  console.log("\nADIM 1: Zımparaya toplu sevk (planlı KESTEL'den çözülür, okutmasız)");
  const bulkRes = await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep }, ADMIN);
  const dispatch1Id = (bulkRes.data as { id: string }).id;
  const afterBulk = await prisma.roll.findMany({
    where: { id: { in: [r1, r2] } },
    select: { status: true, currentStepId: true },
  });
  check(
    "Toplu sevk sonrası 2 top AT_SUBCONTRACTOR @ Zımpara",
    afterBulk.length === 2 && afterBulk.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR && r.currentStepId === zimparaStep),
    afterBulk.map((r) => r.status).join(","),
  );
  const zimparaStatus1 = (await prisma.workOrderStep.findUnique({ where: { id: zimparaStep }, select: { status: true } }))!.status;
  check("Zımpara adımı ACTIVE", zimparaStatus1 === StepStatus.ACTIVE, zimparaStatus1);
  const doc1 = await prisma.printedDocument.findFirst({ where: { sourceId: dispatch1Id } });
  check("Gerçek irsaliye (PrintedDocument) donduruldu", doc1 !== null);

  // ── 5) GUARD: bekleyen top kalmadı → tekrar toplu sevk reddedilmeli ──
  await expectReject(
    "Bekleyen top yokken toplu sevk reddedildi",
    () => sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep }, ADMIN),
    "bekleyen top yok",
  );

  // ── 6) HAPPY: transferToNextFason(zımpara → boyahane) doğrudan aktarım ──
  console.log("\nADIM 2: Zımpara → Boyahane doğrudan aktarım (kabul + sevk zinciri)");
  const transferRes = await sub.transferToNextFason({ workOrderId: woId, stepId: zimparaStep }, ADMIN);
  const dispatch2Id = (transferRes.data as { id: string }).id;

  const origAfter = await prisma.roll.findMany({
    where: { id: { in: [r1, r2] } },
    select: { status: true, currentStepId: true },
  });
  check(
    "Orijinal zımpara topları SUBCONTRACTOR_CONSUMED + step temizlendi",
    origAfter.every((r) => r.status === RollStatus.SUBCONTRACTOR_CONSUMED && r.currentStepId === null),
  );

  const born = await prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: woId }, producedInStepId: zimparaStep, parentRollId: null },
    select: { id: true, status: true, currentStepId: true, currentQty: true },
  });
  check("Zımpara aktarımında born açık-kumaş toplar doğdu (2)", born.length === 2, `adet=${born.length}`);
  check(
    "Born toplar AT_SUBCONTRACTOR @ Boyahane (sonraki fasona sevk edildi)",
    born.length > 0 && born.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR && r.currentStepId === boyaStep),
    born.map((r) => `${r.status}@${r.currentStepId === boyaStep ? "Boya" : r.currentStepId}`).join(","),
  );
  check(
    "Metraj 1:1 taşındı (zımparada çekme yok)",
    born.every((r) => Number(r.currentQty) === 300),
    born.map((r) => Number(r.currentQty)).join(","),
  );
  const doc2 = await prisma.printedDocument.findFirst({ where: { sourceId: dispatch2Id } });
  check("Boyahane sevki için gerçek irsaliye donduruldu", doc2 !== null);

  const steps = await prisma.workOrderStep.findMany({ where: { id: { in: stepIds } }, select: { id: true, status: true } });
  const stMap = (id: string): StepStatus => steps.find((s) => s.id === id)!.status;
  check("Zımpara adımı COMPLETED", stMap(zimparaStep) === StepStatus.COMPLETED, stMap(zimparaStep));
  check("Boyahane adımı ACTIVE (mal fasonda)", stMap(boyaStep) === StepStatus.ACTIVE, stMap(boyaStep));
  check("Tambur adımı hâlâ PENDING", stMap(tamburStep) === StepStatus.PENDING, stMap(tamburStep));

  // ── 7) GUARD: sonraki adım internal (Tambur) → boyahaneden aktarım reddedilmeli ──
  await expectReject(
    "Sonraki adım fason değilken aktarım reddedildi (Fason Kabul yönlendirmesi)",
    () => sub.transferToNextFason({ workOrderId: woId, stepId: boyaStep }, ADMIN),
    "Sonraki adım fason değil",
  );

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
          { barcode: { startsWith: "TST-FDD-" } },
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
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, woId] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: woId } });
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
