// TEST: Partiyi yeni iş emrine ayır — RE-DYE (Faz B2, boyandıktan sonra).
//
// Senaryo: Rota KK1 → Boyahane(renk) → Tambur. Parti boyahaneye gidip DÖNER
// (açık kumaş, eski renk A, Tambur'da bekler). Sonra "rengi yanlış" → yeni iş
// emrine ayır (re-dye): yeni WO parti'yi BOYAHANE adımına geri sarar, yeni renk
// B ile yeniden boyanmak üzere. Yeniden sevk + kabulde yeni renk uygulanmalı.
//
// Çalıştır: npx ts-node scripts/test_wo_branch_redye.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";

// Fixture id'leri seed'den runtime'da çözülür (re-seed sonrası hardcoded id kırılırdı).
let ITEM = "";
let GRADE = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_TAMBUR = "";
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
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-RDY-${rand}${bc}`;
}
async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN },
  });
  return r.id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const woIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  // Firma + kategori TEK kaynaktan (fixture) — eski "appliesColor kategorisine bağlı
  // HERHANGİ bir firma" araması pasif seed firmasını (BOYER) seçip düşüyordu.
  const dyeHouse = await ensureTestDyeHouse();
  const dye = { id: dyeHouse.categoryId };
  const SUB = dyeHouse.id;
  const kk1 = await prisma.station.findFirst({ where: { kind: "RAW_QC" }, select: { id: true } });
  const colors = await prisma.color.findMany({ where: { isActive: true }, take: 2, select: { id: true, name: true } });
  const colorA = colors[0], colorB = colors[1];
  console.log(`\nRenk A (eski)=${colorA.name}  Renk B (yeni)=${colorB.name}\n`);

  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-RDY-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM, targetColorId: colorA.id,
      steps: { create: [
        { stationId: kk1!.id, stepSequence: 1, status: "PENDING" },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", requiredCategoryId: dye!.id },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  const srcBoya = wo.steps[1].id, srcTambur = wo.steps[2].id;
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  // Parti → Boyahane → DÖN (eski renk A uygulanır, açık kumaş Tambur'da bekler)
  const p = [await stockRoll(300), await stockRoll(300)];
  const d = await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: p }, ADMIN);
  // Parti-modeli: "lane" (eski dispatch.id = batchSplitId) yerine kaynak sevkin partisi (batchId).
  const srcBatchId = (d.data as Any).batchId as string;
  const rc = await sub.receive({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB,
    returns: p.map((id) => ({ rollId: id })), newRolls: [{ qty: 560 }] }, ADMIN);
  const bornA = await prisma.roll.findFirst({ where: { parentReceiptId: (rc.data as Any).id },
    select: { id: true, colorId: true, currentStepId: true, status: true, batchId: true } });
  check("Parti döndü: açık kumaş eski renk A + Tambur'da IN_PRODUCTION", bornA?.colorId === colorA.id && bornA?.currentStepId === srcTambur && bornA?.status === RollStatus.IN_PRODUCTION);
  check("Dönen top partisi (batchId) kalıttı", bornA?.batchId === srcBatchId);

  // ── ÖNİZLEME: re-dye modu ──
  const prev = (await wos.getSplitPreview(wo.id, srcBatchId)).data as Any;
  check("Preview: ayrılabilir", (prev.allowedModes?.length ?? 0) > 0, prev.blockReason ?? "");
  check("Preview: NEW_COLOR modu uygun (boyandı)", (prev.allowedModes ?? []).includes("NEW_COLOR"), (prev.allowedModes ?? []).join(",") || "yok");
  check("Preview: şu an Tambur'da", prev.rolls?.[0]?.currentStepId === srcTambur);
  check("Preview: yeniden giriş = Boyahane", prev.colorStepId === srcBoya);

  // ── AYIR (re-dye): yeni renk B, boyahaneye geri sar ──
  const res = (await wos.splitBranch(wo.id, { batchId: srcBatchId, mode: "NEW_COLOR", newColorId: colorB.id, orderMode: "stock" }, ADMIN)).data as Any;
  const newWoId = res.newWorkOrderId as string;
  woIds.push(newWoId);
  check("Split: yeni WO oluştu", typeof newWoId === "string" && newWoId !== wo.id);

  const newWo = await prisma.workOrder.findUnique({ where: { id: newWoId },
    select: { targetColorId: true, steps: { orderBy: { stepSequence: "asc" }, select: { id: true, stationId: true, status: true } } } });
  check("Yeni WO targetColor = B", newWo?.targetColorId === colorB.id);
  check("Yeni WO KK1 COMPLETED", newWo?.steps[0].status === StepStatus.COMPLETED, String(newWo?.steps[0].status));
  check("Yeni WO Boyahane ACTIVE (geri sarıldı)", newWo?.steps[1].status === StepStatus.ACTIVE, String(newWo?.steps[1].status));
  check("Yeni WO Tambur PENDING", newWo?.steps[2].status === StepStatus.PENDING, String(newWo?.steps[2].status));
  const newBoya = newWo!.steps[1].id, newTambur = newWo!.steps[2].id;

  const moved = await prisma.roll.findUnique({ where: { id: bornA!.id },
    select: { currentStepId: true, producedInStepId: true, status: true, batchId: true } });
  check("Top BOYAHANE adımına geri sarıldı (currentStep)", moved?.currentStepId === newBoya, String(moved?.currentStepId));
  check("Top IN_PRODUCTION (sevke hazır)", moved?.status === RollStatus.IN_PRODUCTION);
  check("Top eski partiden koptu (yeni batchId)", moved?.batchId != null && moved?.batchId !== srcBatchId, String(moved?.batchId));
  check("Top producedInStep = yeni Boyahane", moved?.producedInStepId === newBoya);

  // Bug 1 regresyon: SPLIT WO "Üretime Giren" > 0. Enjekte kök (bornA = kaynak
  // WO'nun 560m fason-dönüşü) yeni WO'nun reEntry adımında (Boyahane seq2) durur;
  // eski "yalnız ilk adım (KK1 seq1)" çapası bunu 0 sayıyordu. computeWoInput
  // girdi-kökü tanımı artık sayar (parentReceipt KAYNAK WO'ya işaret eder ≠ yeni WO).
  const newDetail = (await wos.findById(newWoId)).data as Any;
  check("Bug1: split WO inputRolls.count = 1 (enjekte kök)", newDetail?.inputRolls?.count === 1, `count=${newDetail?.inputRolls?.count}`);
  check("Bug1: split WO inputRolls.totalMeters = 560 (eskiden 0)", Number(newDetail?.inputRolls?.totalMeters) === 560, `meters=${newDetail?.inputRolls?.totalMeters}`);

  // Boyahane adımında taze açık movement açıldı + eski (Tambur) movement kapandı
  const openMov = await prisma.rollMovement.findFirst({ where: { rollId: bornA!.id, exitedAt: null }, select: { workOrderStepId: true } });
  check("Taze açık movement yeni Boyahane'de", openMov?.workOrderStepId === newBoya, String(openMov?.workOrderStepId));
  const openCount = await prisma.rollMovement.count({ where: { rollId: bornA!.id, exitedAt: null } });
  check("Sadece TEK açık movement (eski kapandı)", openCount === 1, `${openCount}`);

  // ── YENİDEN SEVK + KABUL: yeni renk B uygulanmalı ──
  console.log("\nYENİDEN BOYAMA: yeni WO'dan boyahaneye sevk + kabul");
  await sub.dispatch({ workOrderId: newWoId, stepId: newBoya, subcontractorId: SUB, rollIds: [bornA!.id] }, ADMIN);
  const afterReDispatch = await prisma.roll.findUnique({ where: { id: bornA!.id }, select: { status: true, batchId: true } });
  check("Yeniden sevkte top AT_SUBCONTRACTOR + YENİ parti aldı", afterReDispatch?.status === RollStatus.AT_SUBCONTRACTOR && afterReDispatch?.batchId != null && afterReDispatch?.batchId !== srcBatchId);

  const rc2 = await sub.receive({ workOrderId: newWoId, stepId: newBoya, subcontractorId: SUB,
    returns: [{ rollId: bornA!.id }], newRolls: [{ qty: 555 }] }, ADMIN);
  const bornB = await prisma.roll.findFirst({ where: { parentReceiptId: (rc2.data as Any).id },
    select: { colorId: true, currentStepId: true } });
  check("Yeniden boyama kabulünde YENİ renk B uygulandı", bornB?.colorId === colorB.id, `beklenen ${colorB.id?.slice(0,8)} geldi ${bornB?.colorId?.slice(0,8)}`);
  check("Yeniden boyanan top yeni WO Tambur'da", bornB?.currentStepId === newTambur);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: { OR: [ { currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } },
        { parentReceipt: { workOrderId: { in: woIds } } }, { barcode: { startsWith: "TST-RDY-" } } ] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((dd) => dd.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
    // Parti-modeli FK: rulolar/dispatch'ler silindikten SONRA, WO'dan ÖNCE partileri sil
    // (batches_workOrderId_fkey + rolls/dispatch.batchId → Batch).
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
