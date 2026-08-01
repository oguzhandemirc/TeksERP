// REGRESYON (Faz 0b — cross-WO parti sızıntısı): Sevk iptali batchId'yi BİLİNÇLİ
// korur (parti üyeliği attach'te doğar, iptal bozamaz). Bu yüzden iptal sonrası
// STOCK+stepless top BAŞKA iş emrinin partisini taşır. Guard öncesi dispatch()
// böyle bir topu "serbest" sanıp eski batchId'yi bu sevkin partisi yapıyordu →
// yabancı WO'nun partisi bu WO'nun sevkine sızıyor, splitRemainder yabancı
// partiyi bölüyordu (K10 ihlali).
//
// Doğrulanan davranışlar:
//   1. İptal sonrası top: STOCK + currentStepId=null + batchId KORUNMUŞ.
//   2. Aynı WO'da yeniden sevk: aynı partiyle yola çıkar (korumanın amacı).
//   3. WO-B'den doğrudan sevk (auto-attach yolu): FOREIGN_BATCH → 400, sevk
//      kaydı doğmaz, topa dokunulmaz. MERGE stratejisi de guard'ı BYPASS EDEMEZ.
//   4. Meşru yol: attachRolls(WO-B) yeni WO-B partisi damgalar → sevk başarılı,
//      dispatch.batchId WO-B'nin partisi (yabancı parti DEĞİL).
//
// Çalıştır: npx tsx scripts/test_dispatch_cross_wo_batch_guard.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

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
  SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "Subcontractor BOYER");
}

const sub = new SubcontractorService();
const wos = new WorkOrderService();
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
  return `TST-XWB-${rand}${bc}`;
}

async function stockRoll(qty: number): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code,
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
  return { id: r.id, barcode: code };
}

async function makeWo(suffix: string): Promise<{ id: string; boyaStep: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-XWB-${suffix}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
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
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  return { id: wo.id, boyaStep: wo.steps[0].id };
}

const woIds: string[] = [];
const stepIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  const stamp = `${Date.now()}`.slice(-6);

  const woA = await makeWo(`A${stamp}`);
  const woB = await makeWo(`B${stamp}`);
  woIds.push(woA.id, woB.id);
  const stepsAll = await prisma.workOrderStep.findMany({
    where: { workOrderId: { in: woIds } },
    select: { id: true },
  });
  stepIds.push(...stepsAll.map((s) => s.id));
  console.log(`\nWO-A: TST-XWB-A${stamp}  /  WO-B: TST-XWB-B${stamp}\n`);

  // ── 1) WO-A: 2 top fasona sevk (auto-attach parti doğurur) ──
  const r1 = await stockRoll(300);
  const r2 = await stockRoll(300);
  const d1 = await sub.dispatch(
    { workOrderId: woA.id, stepId: woA.boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1.id, r2.id] },
    ADMIN,
  );
  const d1Id = (d1.data as { id: string }).id;
  const afterDispatch = await prisma.roll.findMany({
    where: { id: { in: [r1.id, r2.id] } },
    select: { batchId: true, status: true },
  });
  const batchA = afterDispatch[0].batchId;
  check(
    "WO-A sevki: 2 top AT_SUBCONTRACTOR + tek partide",
    batchA !== null &&
      afterDispatch.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR && r.batchId === batchA),
  );
  const batchARow = await prisma.batch.findUnique({
    where: { id: batchA! },
    select: { batchNumber: true, workOrderId: true },
  });
  check("Parti WO-A'ya ait", batchARow?.workOrderId === woA.id, batchARow?.batchNumber ?? "?");

  // ── 2) Sevk iptali: STOCK + stepless AMA batchId KORUNUR (bilinçli) ──
  await sub.cancel(d1Id, "cross-WO guard testi", ADMIN);
  const afterCancel = await prisma.roll.findMany({
    where: { id: { in: [r1.id, r2.id] } },
    select: { status: true, currentStepId: true, batchId: true },
  });
  check(
    "İptal sonrası toplar STOCK + currentStepId=null",
    afterCancel.every((r) => r.status === RollStatus.STOCK && r.currentStepId === null),
  );
  check(
    "İptal sonrası batchId KORUNMUŞ (parti üyeliği iptalle bozulmaz)",
    afterCancel.every((r) => r.batchId === batchA),
  );

  // ── 3) Korumanın amacı: aynı WO'da yeniden sevk aynı partiyle yola çıkar ──
  const d2 = await sub.dispatch(
    { workOrderId: woA.id, stepId: woA.boyaStep, subcontractorId: SUB_BOYER, rollIds: [r2.id] },
    ADMIN,
  );
  const d2Row = await prisma.subcontractorDispatch.findUnique({
    where: { id: (d2.data as { id: string }).id },
    select: { batchId: true },
  });
  check("WO-A'da yeniden sevk: dispatch.batchId aynı parti", d2Row?.batchId === batchA);

  // K5 oto-böl yan etkisi: sevke girmeyen kalan (r1) WO-A'nın YENİ kalan
  // partisine ayrıldı (splitFromId=batchA). r1 artık bu partiyi taşır — cross-WO
  // denemesinde "dokunulmadı" assertion'ının referansı budur.
  const r1PreAttack = await prisma.roll.findUnique({
    where: { id: r1.id },
    select: { batchId: true, batch: { select: { workOrderId: true, splitFromId: true } } },
  });
  const batchA2 = r1PreAttack?.batchId ?? null;
  check(
    "K5 kalan-böl: r1 WO-A'nın kalan partisinde (splitFrom=ilk parti)",
    batchA2 !== null &&
      batchA2 !== batchA &&
      r1PreAttack?.batch?.workOrderId === woA.id &&
      r1PreAttack?.batch?.splitFromId === batchA,
  );

  // ── 4) KRİTİK: WO-B'den doğrudan sevk (auto-attach) → FOREIGN_BATCH 400 ──
  console.log("\nKRİTİK: WO-A partili STOCK topu WO-B sevkine sokma denemesi");
  // NEDEN adlandırılmış tip (`typeof err` DEĞİL): `typeof err` catch içinde akış
  // daraltmasıyla `null`'a iner → `e as typeof err` = `e as null` → aşağıdaki
  // statusCode/details kontrolleri `never` üzerinde çalışır ve FOREIGN_BATCH
  // guard'ının 400 gövdesi derleme tarafında hiç doğrulanmazdı.
  type DispatchErr = Error & { statusCode?: number; details?: { code?: string } };
  let err: DispatchErr | null = null;
  try {
    await sub.dispatch(
      { workOrderId: woB.id, stepId: woB.boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1.id] },
      ADMIN,
    );
  } catch (e) {
    err = e as DispatchErr;
  }
  check("Sevk REDDEDİLDİ (hata fırladı)", err !== null, err?.message ?? "hata yok!");
  check("400 badRequest", err?.statusCode === 400, `statusCode=${err?.statusCode}`);
  check("code=FOREIGN_BATCH", err?.details?.code === "FOREIGN_BATCH");
  const woBDispatchCount = await prisma.subcontractorDispatch.count({ where: { workOrderId: woB.id } });
  check("WO-B'de sevk kaydı DOĞMADI", woBDispatchCount === 0);
  const r1After = await prisma.roll.findUnique({
    where: { id: r1.id },
    select: { status: true, currentStepId: true, batchId: true },
  });
  check(
    "Topa dokunulmadı (STOCK + stepless + batchId aynı)",
    r1After?.status === RollStatus.STOCK && r1After?.currentStepId === null && r1After?.batchId === batchA2,
  );

  // ── 5) MERGE stratejisi guard'ı bypass EDEMEZ ──
  const rFree = await stockRoll(200);
  // (Yukarıdakiyle aynı gerekçe — `typeof errMerge` catch'te `null`'a inerdi.)
  type MergeErr = Error & { details?: { code?: string } };
  let errMerge: MergeErr | null = null;
  try {
    await sub.dispatch(
      {
        workOrderId: woB.id,
        stepId: woB.boyaStep,
        subcontractorId: SUB_BOYER,
        rollIds: [r1.id, rFree.id],
        multiBatchStrategy: "MERGE",
      },
      ADMIN,
    );
  } catch (e) {
    errMerge = e as MergeErr;
  }
  check("MERGE ile de FOREIGN_BATCH", errMerge?.details?.code === "FOREIGN_BATCH", errMerge?.message ?? "hata yok!");

  // ── 6) Meşru yol: attachRolls(WO-B) yeni WO-B partisi damgalar → sevk temiz ──
  const attachRes = await wos.attachRolls(woB.id, [r1.barcode], ADMIN);
  check("attachRolls(WO-B) başarılı", attachRes.data.attached === 1, attachRes.data.errors.join("; "));
  const d3 = await sub.dispatch(
    { workOrderId: woB.id, stepId: woB.boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1.id] },
    ADMIN,
  );
  const d3Row = await prisma.subcontractorDispatch.findUnique({
    where: { id: (d3.data as { id: string }).id },
    select: { batchId: true, batch: { select: { workOrderId: true, batchNumber: true } } },
  });
  check(
    "WO-B sevkinin partisi WO-B'ye ait (yabancı parti sızmadı)",
    d3Row?.batchId !== batchA && d3Row?.batchId !== batchA2 && d3Row?.batch?.workOrderId === woB.id,
    d3Row?.batch?.batchNumber ?? "?",
  );
  const batchAStill = await prisma.batch.findUnique({ where: { id: batchA! }, select: { workOrderId: true } });
  check("WO-A partisi hâlâ WO-A'da (dokunulmadı)", batchAStill?.workOrderId === woA.id);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
          { barcode: { startsWith: "TST-XWB-" } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const dispatchIds = dispatches.map((d) => d.id);

    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, ...woIds] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
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
