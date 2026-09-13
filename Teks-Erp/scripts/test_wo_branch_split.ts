// TEST: Partiyi yeni iş emrine ayır (Faz B1 — boyanmadan).
//
// Senaryo: Rota KK1 → Boyahane(renk) → Tambur. İki parti boyahaneye sevk edilir.
// Parti-2 farklı renk olacak → "yeni iş emrine ayır". Yeni WO birebir aynı rota +
// özellikler ama YENİ renk; parti kaldığı yerden (boyahane) devam eder. Yeni renk
// parti yeni WO'ya KABUL edilince uygulanmalı. Kaynak WO'da parti-1 dokunulmaz.
//
// Çalıştır: npx ts-node scripts/test_wo_branch_split.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

// Fixture id'leri seed'den runtime'da çözülür (re-seed sonrası hardcoded id kırılırdı).
let ITEM = "";
let GRADE = "";
let GRADE_CODE = "";
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
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
}

const sub = new SubcontractorService();
const wos = new WorkOrderService();
const cards = new TravelerCardService();

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-SPL-${rand}${bc}`;
}
async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN },
  });
  return r.id;
}

// Fixture kaçış kapısı: `no-explicit-any` bekçi kapsamında AÇIK DEĞİL
// (eslint.config.mjs § KAPSAM) — bu takma ad, `any`yi tek noktada görünür tutar.
type Any = any;
const woIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  // ── Bağımlılıkları çöz: renk veren fason kategorisi + ona bağlı firma + KK1 + 2 renk ──
  // Firma + kategori TEK kaynaktan (fixture) — eski "appliesColor kategorisine bağlı
  // HERHANGİ bir firma" araması pasif seed firmasını (BOYER) seçip düşüyordu.
  const dyeHouse = await ensureTestDyeHouse();
  const dye = { id: dyeHouse.categoryId };
  const SUB = dyeHouse.id;
  const kk1 = await prisma.station.findFirst({ where: { kind: "RAW_QC" }, select: { id: true } });
  if (!kk1) throw new Error("KK1 (RAW_QC) istasyonu yok");
  const colors = await prisma.color.findMany({ where: { isActive: true }, take: 2, select: { id: true, name: true } });
  if (colors.length < 2) throw new Error("En az 2 aktif renk gerekli");
  const colorA = colors[0]; // kaynak hedef renk
  const colorB = colors[1]; // ayrılan partinin yeni rengi
  console.log(`\nRenk A (kaynak)=${colorA.name}  Renk B (ayrılan)=${colorB.name}\n`);

  // ── Kaynak WO: KK1 → Boyahane(renk) → Tambur ──
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-SPL-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 2000, targetItemId: ITEM, targetColorId: colorA.id,
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

  // ── Parti-1 (2 top) + Parti-2 (3 top) → Boyahane ──
  const p1 = [await stockRoll(300), await stockRoll(300)];
  const d1 = await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: p1 }, ADMIN);
  const lane1 = (d1.data as Any).id as string;
  const p2 = [await stockRoll(200), await stockRoll(200), await stockRoll(200)];
  const d2 = await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: p2 }, ADMIN);
  const lane2 = (d2.data as Any).id as string;
  // Parti-modeli: split/preview anahtarı artık dispatch id değil Batch id (roll.batchId).
  const batch2 = (d2.data as Any).batchId as string;
  console.log(`Parti-1 lane=${lane1.slice(0,8)} (2 top) · Parti-2 lane=${lane2.slice(0,8)} (3 top)\n`);

  // ── ÖNİZLEME ── (yeni preview shape: allowedModes/blockReason/rollCount; canSplit/mode KALKTI)
  const prev = (await wos.getSplitPreview(wo.id, batch2)).data as Any;
  check("Preview: ayrılabilir (blockReason yok)", prev.allowedModes.length > 0 && prev.blockReason == null, prev.blockReason ?? "");
  check("Preview: 3 top taşınacak", prev.rollCount === 3, `${prev.rollCount}`);
  // Toplar fasonda (AT_SUBCONTRACTOR, boyanmadan) → tek izinli mod UNDYED_MOVE
  // (redye modları yalnız boyanmış/depo topları için). Renk split'te DEĞİL, receive'de uygulanır.
  check("Preview: izinli mod = UNDYED_MOVE (boyanmadan)", prev.allowedModes.includes("UNDYED_MOVE") && !prev.allowedModes.includes("NEW_COLOR"), (prev.allowedModes ?? []).join(","));

  // ── AYIR: parti-2 → yeni WO (UNDYED_MOVE — boyanmadan taşınır; hedef renk B RECEIVE'de uygulanır) ──
  const res = (await wos.splitBranch(wo.id, { batchId: batch2, mode: "UNDYED_MOVE", orderMode: "stock" }, ADMIN)).data as Any;
  const newWoId = res.newWorkOrderId as string;
  woIds.push(newWoId);
  check("Split: yeni WO oluştu", typeof newWoId === "string" && newWoId !== wo.id);
  check("Split: 3 top taşındı", res.movedRollCount === 3, `${res.movedRollCount}`);

  // ── Yeni WO doğrulaması ──
  const newWo = await prisma.workOrder.findUnique({
    where: { id: newWoId },
    select: { type: true, targetItemId: true, targetColorId: true, status: true,
      steps: { orderBy: { stepSequence: "asc" }, select: { id: true, stationId: true, stepSequence: true, status: true, requiredCategoryId: true } } },
  });
  check("Yeni WO type=STOCK_PRODUCTION (stok modu)", newWo?.type === "STOCK_PRODUCTION", String(newWo?.type));
  // UNDYED_MOVE hedef rengi split'te BELİRLEMEZ — yeni WO kaynağın hedef rengini (A) miras alır;
  // parti-2'nin yeni rengi B, aşağıda receive'de appliedColorId ile uygulanır.
  check("Yeni WO targetColor = kaynak renk A (UNDYED_MOVE mirası)", newWo?.targetColorId === colorA.id);
  check("Yeni WO targetItem kaynakla aynı", newWo?.targetItemId === ITEM);
  check("Yeni WO 3 adım (birebir rota)", newWo?.steps.length === 3, `${newWo?.steps.length}`);
  check("Yeni WO istasyon sırası birebir (KK1→Boya→Tambur)",
    newWo?.steps[0].stationId === kk1.id && newWo?.steps[1].stationId === ST_BOYA && newWo?.steps[2].stationId === ST_TAMBUR);
  check("Yeni WO Boyahane adımı kategoriyi kalıttı (appliesColor için)", newWo?.steps[1].requiredCategoryId === dye.id);
  // Statü: KK1 COMPLETED (S öncesi), Boya ACTIVE (S), Tambur PENDING
  check("Yeni WO KK1 COMPLETED (kaldığı yerden devam — öncesi tamamlandı)", newWo?.steps[0].status === StepStatus.COMPLETED, String(newWo?.steps[0].status));
  check("Yeni WO Boyahane ACTIVE (parti burada)", newWo?.steps[1].status === StepStatus.ACTIVE, String(newWo?.steps[1].status));
  check("Yeni WO Tambur PENDING", newWo?.steps[2].status === StepStatus.PENDING, String(newWo?.steps[2].status));
  const newBoya = newWo!.steps[1].id;

  // Parti-2 topları yeni boyahane adımında, hâlâ AT_SUBCONTRACTOR, lane korunmuş
  const movedRolls = await prisma.roll.findMany({ where: { id: { in: p2 } }, select: { status: true, currentStepId: true, batchId: true } });
  check("Parti-2 topları AT_SUBCONTRACTOR (boyanmadan)", movedRolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR));
  check("Parti-2 topları YENİ boyahane adımında", movedRolls.every((r) => r.currentStepId === newBoya));
  check("Parti-2 batchId korundu (batch2)", movedRolls.every((r) => r.batchId === batch2));

  // Açık sevk yeni WO'ya taşındı
  const movedDispatch = await prisma.subcontractorDispatch.findUnique({ where: { id: lane2 }, select: { workOrderId: true, stepId: true } });
  check("Açık sevk (lane2) yeni WO'ya taşındı", movedDispatch?.workOrderId === newWoId && movedDispatch?.stepId === newBoya);

  // Açık movement repoint edildi (recomputeStepStatus için şart)
  const openMov = await prisma.rollMovement.findFirst({ where: { rollId: p2[0], exitedAt: null }, select: { workOrderStepId: true } });
  check("Parti-2 açık movement yeni boyahane adımına repoint", openMov?.workOrderStepId === newBoya, String(openMov?.workOrderStepId));

  // Yeni WO refakat kartı
  const newCard = await prisma.travelerCard.count({ where: { workOrderId: newWoId, status: "ACTIVE" } });
  check("Yeni WO için yeni refakat kartı oluştu", newCard >= 1, `${newCard}`);

  // ── Kaynak WO: parti-1 dokunulmadı ──
  const srcRolls = await prisma.roll.findMany({ where: { id: { in: p1 } }, select: { status: true, currentStepId: true } });
  check("Kaynak parti-1 topları dokunulmadı (kaynak boyahanede)", srcRolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR && r.currentStepId === srcBoya));
  const srcBoyaStep = await prisma.workOrderStep.findUnique({ where: { id: srcBoya }, select: { status: true } });
  check("Kaynak Boyahane hâlâ ACTIVE (parti-1 orada)", srcBoyaStep?.status === StepStatus.ACTIVE, String(srcBoyaStep?.status));

  // ── KABUL: parti-2'yi YENİ WO'ya kabul et → YENİ renk uygulanmalı ──
  console.log("\nKABUL — parti-2 yeni WO'ya (yeni renk uygulanmalı)");
  const rc = await sub.receive({ workOrderId: newWoId, stepId: newBoya, subcontractorId: SUB, appliedColorId: colorB.id,
    returns: p2.map((id) => ({ rollId: id })), newRolls: [{ qty: 560 }] }, ADMIN);
  const receipt = rc.data as Any;
  const born = await prisma.roll.findFirst({ where: { parentReceiptId: receipt.id }, select: { colorId: true, batchId: true, currentStepId: true } });
  check("Parti-2 kabulünde doğan açık kumaş YENİ renk (B) aldı", born?.colorId === colorB.id, `beklenen ${colorB.id?.slice(0,8)} geldi ${born?.colorId?.slice(0,8)}`);
  check("Doğan top batch2'yi kalıttı", born?.batchId === batch2);
  check("Doğan top yeni WO Tambur adımında", born?.currentStepId === newWo!.steps[2].id);

  // ── KABUL: parti-1'i KAYNAK WO'ya → ESKİ renk (A) ──
  console.log("KABUL — parti-1 kaynak WO'ya (eski renk korunmalı)");
  const rcA = await sub.receive({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB,
    returns: p1.map((id) => ({ rollId: id })), newRolls: [{ qty: 580 }] }, ADMIN);
  const bornA = await prisma.roll.findFirst({ where: { parentReceiptId: (rcA.data as Any).id }, select: { colorId: true } });
  check("Kaynak parti-1 doğan top ESKİ renk (A) aldı", bornA?.colorId === colorA.id);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: { OR: [
        { currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } },
        { parentReceipt: { workOrderId: { in: woIds } } }, { barcode: { startsWith: "TST-SPL-" } },
      ] }, select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
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
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
    // Parti-modeli: dispatch/roll batchId → Batch FK; WO silmeden önce partileri temizle (batches_workOrderId_fkey).
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
