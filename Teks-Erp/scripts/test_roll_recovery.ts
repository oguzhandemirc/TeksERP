// =============================================================================
// TEST: "Üretime Geri Al" — ham stokta takılı açık kumaş kurtarma
// Çalıştır: npx tsx scripts/test_roll_recovery.ts
// =============================================================================
// Kapsam (PR-1 feat/roll-recovery-manual-adjust):
//   1) Orphan üret: fason SON ADIMKEN dönen açık kumaş → STOCK + currentStepId=null
//      + barcode=null (subcontractor born-roll, nextStep yok).
//   2) getRecoveryTargets: orphan eligible=true; hedefler = aynı ürünlü, açık,
//      Tambur'lu WO adımları. Yanlış-ürünlü WO + Tambur'suz WO hedefte YOK.
//   3) Uygun olmayan top (barkodlu stok) → eligible=false.
//   4) recoverOpenFabricToProduction: orphan IN_PRODUCTION + currentStepId/
//      producedInStepId=Tambur step + açık RollMovement(qtyIn=metraj) + step ACTIVE
//      + WO IN_PROGRESS.
//   5) Negatif: Tambur olmayan adıma geri al → 400; barkodlu topu geri al → 400;
//      çift geri al (zaten IN_PRODUCTION) → 409.
//   6) E2E: kurtarılan orphan Tambur'da kesilir (cutOpenFabric → child WAREHOUSE);
//      finalizeOpenFabric → parent TAMBUR_CONSUMED.
// =============================================================================

import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TamburService } from "../src/services/tambur.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); check(label, false, "hata bekleniyordu, atılmadı"); }
  catch { check(label, true); }
}

const inv = new InventoryService();
const sub = new SubcontractorService();
const tambur = new TamburService();
const cards = new TravelerCardService();

let ITEM = "", ITEM2 = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_TAMBUR = "", ST_KURSUN = "", SUB_BOYER = "", COLOR = "";
const WIDTH = 220;
const woIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-REC-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  // İkinci ürün seed'de GARANTİ DEĞİL (taze seed yalnız PATOS) → testin kendi TEST-
  // ürününü yaratır. woC "yanlış ürün → uygunsuz" senaryosu için PATOS'tan farklı OLMALI.
  ITEM2 = (await prisma.item.create({
    data: { code: `TST-REC-ITEM2-${Date.now()}`, name: "TEST İkinci Kumaş", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  })).id;
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "BOYER");
  COLOR = need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "renk");
}

async function makeStockRoll(qty: number, itemId: string): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code, itemId, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE,
      width: WIDTH, createdById: ADMIN,
    },
    select: { id: true },
  });
  return { id: r.id, barcode: code };
}

async function makeWo(stepDefs: { stationId: string; seq: number }[], itemId: string): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-REC-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED",
      width: WIDTH, targetQuantity: 1000, targetItemId: itemId,
      steps: { create: stepDefs.map((s) => ({ stationId: s.stationId, stepSequence: s.seq, status: "PENDING" as const })) },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

// Fason SON ADIMKEN dönen açık kumaş = takılı orphan üret.
async function makeOrphan(itemId: string): Promise<{ orphanId: string; bornQty: number }> {
  const bornQty = 280;
  const { woId, stepIds } = await makeWo([{ stationId: ST_BOYA, seq: 1 }], itemId); // fason TEK/SON adım
  const r = await makeStockRoll(300, itemId);
  await sub.dispatch(
    { workOrderId: woId, stepId: stepIds[0], subcontractorId: SUB_BOYER, rollIds: [r.id] } as Parameters<typeof sub.dispatch>[0],
    ADMIN,
  );
  await sub.receive(
    { workOrderId: woId, stepId: stepIds[0], subcontractorId: SUB_BOYER, returns: [{ rollId: r.id }], newRolls: [{ qty: bornQty }] } as Parameters<typeof sub.receive>[0],
    ADMIN,
  );
  const orphan = await prisma.roll.findFirst({
    where: { producedInStepId: stepIds[0], entrySource: "SUBCONTRACTOR_RETURN", barcode: null },
    select: { id: true, status: true, currentStepId: true, barcode: true, currentQty: true },
  });
  if (!orphan) throw new Error("Orphan üretilemedi (receive born-roll yok)");
  check("orphan üretildi: STOCK + currentStepId=null + barcode=null",
    orphan.status === RollStatus.STOCK && orphan.currentStepId === null && orphan.barcode === null,
    `status=${orphan.status} cs=${orphan.currentStepId} bc=${orphan.barcode}`);
  return { orphanId: orphan.id, bornQty };
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    console.log("\n=== Orphan üret + kurtarma hedefleri ===");
    const { orphanId, bornQty } = await makeOrphan(ITEM);

    // Hedef WO'ları:
    //  B = doğru ürün + tek-adım Tambur (uygun)
    //  C = yanlış ürün + Tambur (item mismatch)
    //  D = doğru ürün ama KURSUN (Tambur değil)
    //  E = doğru ürün, çok-adımlı (KURSUN PENDING → TAMBUR) — BUG-1: üst adım açık → UYGUNSUZ
    //  F = doğru ürün, çok-adımlı ama KURSUN SKIPPED → TAMBUR — üst adım kapalı → UYGUN
    //  G = doğru ürün + Tambur ama targetColorId dolu (orphan colorId=null) — BUG-3: renk mismatch → UYGUNSUZ
    const woB = await makeWo([{ stationId: ST_TAMBUR, seq: 1 }], ITEM);
    const woC = await makeWo([{ stationId: ST_TAMBUR, seq: 1 }], ITEM2);
    const woD = await makeWo([{ stationId: ST_KURSUN, seq: 1 }], ITEM);
    const woE = await makeWo([{ stationId: ST_KURSUN, seq: 1 }, { stationId: ST_TAMBUR, seq: 2 }], ITEM);
    const woF = await makeWo([{ stationId: ST_KURSUN, seq: 1 }, { stationId: ST_TAMBUR, seq: 2 }], ITEM);
    await prisma.workOrderStep.update({ where: { id: woF.stepIds[0] }, data: { status: "SKIPPED" } });
    const woG = await makeWo([{ stationId: ST_TAMBUR, seq: 1 }], ITEM);
    await prisma.workOrder.update({ where: { id: woG.woId }, data: { targetColorId: COLOR } });
    const tamburStepB = woB.stepIds[0];
    const tamburStepC = woC.stepIds[0];
    const kursunStepD = woD.stepIds[0];
    const tamburStepE = woE.stepIds[1];
    const tamburStepF = woF.stepIds[1];
    const tamburStepG = woG.stepIds[0];

    const targetsRes = await inv.getRecoveryTargets(orphanId);
    const targets = targetsRes.data;
    check("getRecoveryTargets: eligible=true", targets.eligible === true);
    const targetStepIds = targets.eligibleTargets.map((t) => t.stepId);
    check("hedeflerde doğru ürün+tek-adım Tambur var (B)", targetStepIds.includes(tamburStepB));
    check("hedeflerde üst-adım kapalı çok-adım Tambur var (F)", targetStepIds.includes(tamburStepF));
    check("hedeflerde yanlış ürün WO YOK (C)", !targetStepIds.includes(tamburStepC));
    check("hedeflerde Tambur olmayan adım YOK (D-kursun)", !targetStepIds.includes(kursunStepD));
    check("BUG-1: üst-adım açık çok-adım Tambur YOK (E)", !targetStepIds.includes(tamburStepE));
    check("BUG-3: renk uyuşmayan WO YOK (G)", !targetStepIds.includes(tamburStepG));

    // Uygun olmayan top (barkodlu stok) → eligible=false
    const plainRoll = await makeStockRoll(50, ITEM);
    const plainTargets = await inv.getRecoveryTargets(plainRoll.id);
    check("barkodlu stok topu: eligible=false", plainTargets.data.eligible === false);

    console.log("\n=== Negatif guard'lar ===");
    await expectThrow("Tambur olmayan adıma geri al → hata", () =>
      inv.recoverOpenFabricToProduction(orphanId, { stepId: kursunStepD, reason: "test kursun" }, ADMIN));
    await expectThrow("barkodlu topu geri al → hata", () =>
      inv.recoverOpenFabricToProduction(plainRoll.id, { stepId: tamburStepB, reason: "test barkodlu" }, ADMIN));
    await expectThrow("boş sebep → hata", () =>
      inv.recoverOpenFabricToProduction(orphanId, { stepId: tamburStepB, reason: "" }, ADMIN));
    await expectThrow("BUG-1: üst-adım açık çok-adım Tambur'a geri al → hata", () =>
      inv.recoverOpenFabricToProduction(orphanId, { stepId: tamburStepE, reason: "çok-adım açık" }, ADMIN));
    await expectThrow("BUG-3: renk uyuşmayan WO'ya geri al → hata", () =>
      inv.recoverOpenFabricToProduction(orphanId, { stepId: tamburStepG, reason: "renk mismatch" }, ADMIN));

    console.log("\n=== Kurtarma (recover) ===");
    const recRes = await inv.recoverOpenFabricToProduction(orphanId, { stepId: tamburStepB, reason: "Saha: takılı açık kumaş üretime alındı" }, ADMIN);
    check("recover success", recRes.success === true);
    const afterRecover = await prisma.roll.findUniqueOrThrow({
      where: { id: orphanId },
      select: { status: true, currentStepId: true, producedInStepId: true },
    });
    check("orphan IN_PRODUCTION", afterRecover.status === RollStatus.IN_PRODUCTION);
    check("currentStepId = Tambur step", afterRecover.currentStepId === tamburStepB);
    check("producedInStepId = Tambur step (overwrite)", afterRecover.producedInStepId === tamburStepB);

    const openMove = await prisma.rollMovement.findFirst({
      where: { rollId: orphanId, workOrderStepId: tamburStepB, exitedAt: null },
      select: { qtyIn: true },
    });
    check("Tambur'a açık movement (qtyIn=metraj)", !!openMove && Number(openMove.qtyIn) === bornQty, `qtyIn=${openMove ? Number(openMove.qtyIn) : "yok"}`);

    const stepBAfter = await prisma.workOrderStep.findUniqueOrThrow({ where: { id: tamburStepB }, select: { status: true } });
    check("Tambur step ACTIVE", stepBAfter.status === StepStatus.ACTIVE, `status=${stepBAfter.status}`);
    const woBAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: woB.woId }, select: { status: true } });
    check("WO IN_PROGRESS", woBAfter.status === WorkOrderStatus.IN_PROGRESS, `status=${woBAfter.status}`);

    // Çift geri al → 409 (zaten IN_PRODUCTION)
    await expectThrow("çift recover → hata (zaten IN_PRODUCTION)", () =>
      inv.recoverOpenFabricToProduction(orphanId, { stepId: tamburStepB, reason: "çift" }, ADMIN));

    console.log("\n=== E2E: Tambur'da kes + bitir ===");
    const cut = await tambur.cutOpenFabric(orphanId, { lengthMeters: 100, status: "WAREHOUSE" }, ADMIN);
    check("cutOpenFabric: child WAREHOUSE", cut.data.childRoll.status === RollStatus.WAREHOUSE);
    check("cutOpenFabric: parent kalan = 180", cut.data.parentRemainingQty === bornQty - 100, `kalan=${cut.data.parentRemainingQty}`);

    await tambur.finalizeOpenFabric(orphanId, { remainingAction: "discard" } as Parameters<typeof tambur.finalizeOpenFabric>[1], ADMIN);
    const parentFinal = await prisma.roll.findUniqueOrThrow({ where: { id: orphanId }, select: { status: true } });
    check("finalizeOpenFabric: parent TAMBUR_CONSUMED", parentFinal.status === RollStatus.TAMBUR_CONSUMED, `status=${parentFinal.status}`);
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function cleanup(): Promise<void> {
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const stepIdSet = steps.map((s) => s.id);
  const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const dispatchIds = dispatches.map((d) => d.id);
  const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const receiptIds = receipts.map((r) => r.id);
  const rolls = await prisma.roll.findMany({
    where: {
      OR: [
        { barcode: { startsWith: "TST-REC-" } },
        { currentStepId: { in: stepIdSet } },
        { producedInStepId: { in: stepIdSet } },
        { parentReceiptId: { in: receiptIds } },
      ],
    },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  // Tambur kesim çocukları (parentRollId orphan) — ayrı yakala
  const children = await prisma.roll.findMany({ where: { parentRollId: { in: rollIds } }, select: { id: true } });
  const allRollIds = [...new Set([...rollIds, ...children.map((c) => c.id)])];
  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: allRollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: allRollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.subcontractorReceiptItem.deleteMany({ where: { OR: [{ receiptId: { in: receiptIds } }, { newRollId: { in: allRollIds } }] } });
  await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { OR: [{ dispatchId: { in: dispatchIds } }, { rollId: { in: allRollIds } }] } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds] } } });
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  // Çocukları önce sil (parentRollId FK)
  await prisma.roll.deleteMany({ where: { id: { in: children.map((c) => c.id) } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIdSet } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  // Testin yarattığı TEST- ürünü (ITEM2) — WO'lar silindikten sonra güvenli.
  if (ITEM2) await prisma.item.deleteMany({ where: { id: ITEM2 } });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
