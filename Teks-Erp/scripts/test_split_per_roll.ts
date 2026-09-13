// TEST: Per-roll split (yeni-renk redye) — DYE-FIRST akışı.
//
// Amaç: bir partideki toplardan SADECE BİRİNİ yeni renge (per-roll) ayırmak.
//
// Redesign gerçeği: NEW_COLOR (yeni-renk redye) yalnız BOYANMIŞ/canlı top ister
// (REDYE_ELIGIBLE_STATUSES = [IN_PRODUCTION, STOCK, WAREHOUSE]). Fasondaki
// (AT_SUBCONTRACTOR = henüz boyanmamış) top yalnız UNDYED_MOVE ile TÜM-parti
// taşınabilir; per-roll ayrılamaz. Bu yüzden DYE-FIRST kur:
//
// Rota KK1 → Boyahane(renk A) → Tambur. 2 top boyahaneye sevk → Fason Kabul (renk A):
// orijinaller SUBCONTRACTOR_CONSUMED, born açık-kumaş toplar Tambur'da IN_PRODUCTION
// doğar (aynı parti). Artık born toplar canlı (IN_PRODUCTION, boyahane sonrası) →
// per-roll NEW_COLOR uygun. born'lardan SADECE BİRİ renk B ile yeni WO'ya ayrılır;
// ayrılan top yeni WO'nun boyahane adımına IN_PRODUCTION geri sarılır (renk kabulde
// uygulanır — split dispatch AÇMAZ). Diğer born top kaynak WO'da orijinal partide kalır.
//
// Çalıştır: npx tsx scripts/test_split_per_roll.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, WorkOrderStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_TAMBUR = "";
let GRADE_CODE = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`fixture eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
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
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}
// Fixture kaçış kapısı: `no-explicit-any` bekçi kapsamında AÇIK DEĞİL
// (eslint.config.mjs § KAPSAM) — bu takma ad, `any`yi tek noktada görünür tutar.
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
  if (!kk1) throw new Error("KK1 yok");
  const colors = await prisma.color.findMany({ where: { isActive: true }, take: 2, select: { id: true, name: true } });
  if (colors.length < 2) throw new Error("2 renk gerekli");
  const colorA = colors[0];
  const colorB = colors[1];
  console.log(`\nRenk A (hedef)=${colorA.name}  Renk B (ayrılan)=${colorB.name}\n`);

  // Kaynak WO: KK1 → Boyahane(renk A) → Tambur.
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-SPR-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM, targetColorId: colorA.id,
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
  const srcTambur = wo.steps[2].id;
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  // ── SEVK: 2 top boyahaneye (AT_SUBCONTRACTOR, parti doğar). ──
  const r1 = await stockRoll(300), r2 = await stockRoll(300);
  const d = await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: [r1, r2] }, ADMIN);
  const lane = (d.data as Any).id as string;
  const batchId = (d.data as Any).batchId as string; // K10: bir sevk = bir parti
  console.log(`Sevk lane=${lane.slice(0, 8)} · parti=${batchId.slice(0, 8)} (2 top boyahanede)`);

  // ── KABUL: renk A ile geri al → orijinaller CONSUMED, born açık-kumaş toplar
  //    (2 adet) aynı partide Tambur'da IN_PRODUCTION doğar. ──
  const rc = await sub.receive(
    { workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, appliedColorId: colorA.id,
      returns: [{ rollId: r1 }, { rollId: r2 }], newRolls: [{ qty: 290 }, { qty: 290 }] },
    ADMIN,
  );
  const receiptId = (rc.data as Any).id as string;
  const bornRolls = await prisma.roll.findMany({
    where: { parentReceiptId: receiptId },
    select: { id: true, status: true, batchId: true, currentStepId: true, colorId: true },
    orderBy: { createdAt: "asc" },
  });
  check("Kabul: 2 born açık-kumaş top doğdu", bornRolls.length === 2, `${bornRolls.length}`);
  check("Kabul: born toplar IN_PRODUCTION (canlı)", bornRolls.every((b) => b.status === RollStatus.IN_PRODUCTION));
  check("Kabul: born toplar Tambur adımında (boyahane sonrası)", bornRolls.every((b) => b.currentStepId === srcTambur));
  check("Kabul: born toplar orijinal partide", bornRolls.every((b) => b.batchId === batchId));
  check("Kabul: born toplar renk A aldı", bornRolls.every((b) => b.colorId === colorA.id));
  const born1 = bornRolls[0].id, born2 = bornRolls[1].id;
  console.log(`\nborn1=${born1.slice(0, 8)} (ayrılacak) · born2=${born2.slice(0, 8)} (kalacak)\n`);

  // ── ÖNİZLEME ── (yeni shape: allowedModes/blockReason; canSplit/mode KALKTI)
  const prev = (await wos.getSplitPreview(wo.id, batchId)).data as Any;
  check("Preview: 2 top listelenir", prev.rollCount === 2, `${prev.rollCount}`);
  check("Preview: 2 top uygun (eligible)", prev.eligibleCount === 2, `${prev.eligibleCount}`);
  check("Preview: NEW_COLOR izinli (boyanmış toplar)", prev.allowedModes.includes("NEW_COLOR"), (prev.allowedModes ?? []).join(","));
  check("Preview: UNDYED_MOVE izinli DEĞİL (fasonda değil)", !prev.allowedModes.includes("UNDYED_MOVE"));

  // ── AYIR: SADECE born1 → renk B ile yeni WO (NEW_COLOR). ──
  const res = (await wos.splitBranch(wo.id, { batchId, mode: "NEW_COLOR", newColorId: colorB.id, orderMode: "stock", rollIds: [born1] }, ADMIN)).data as Any;
  const newWoId = res.newWorkOrderId as string;
  woIds.push(newWoId);
  check("Split: yeni WO oluştu", typeof newWoId === "string" && newWoId !== wo.id);
  check("Split: SADECE 1 top taşındı", res.movedRollCount === 1, `${res.movedRollCount}`);

  // Yeni WO'nun boyahane (renk veren) adımı — born1 buraya geri sarılmalı.
  const newBoya = await prisma.workOrderStep.findFirst({ where: { workOrderId: newWoId, requiredCategoryId: dye.id }, select: { id: true, status: true } });

  // ── born1 → yeni WO, yeni parti, IN_PRODUCTION, boyahane adımında (renk sıfır). ──
  const b1 = await prisma.roll.findUnique({ where: { id: born1 }, select: { status: true, batchId: true, colorId: true, currentStepId: true, currentStep: { select: { workOrderId: true } } } });
  check("born1 IN_PRODUCTION (boyahane adımında bekliyor)", b1?.status === RollStatus.IN_PRODUCTION, String(b1?.status));
  check("born1 YENİ WO'da", b1?.currentStep?.workOrderId === newWoId, String(b1?.currentStep?.workOrderId));
  check("born1 YENİ WO boyahane adımına geri sarıldı", b1?.currentStepId === newBoya?.id, String(b1?.currentStepId));
  check("born1 YENİ parti (batchId ≠ orijinal)", !!b1?.batchId && b1.batchId !== batchId, String(b1?.batchId));
  check("born1 renk sıfırlandı (kabulde B uygulanacak)", b1?.colorId === null, String(b1?.colorId));

  // ── born2 → kaynak WO'da, orijinal partide, Tambur adımında (dokunulmadı). ──
  const b2 = await prisma.roll.findUnique({ where: { id: born2 }, select: { status: true, batchId: true, currentStepId: true, currentStep: { select: { workOrderId: true } } } });
  check("born2 hâlâ IN_PRODUCTION", b2?.status === RollStatus.IN_PRODUCTION, String(b2?.status));
  check("born2 KAYNAK WO'da kaldı", b2?.currentStep?.workOrderId === wo.id, String(b2?.currentStep?.workOrderId));
  check("born2 ORİJİNAL partide", b2?.batchId === batchId, String(b2?.batchId));
  check("born2 Tambur adımında (dokunulmadı)", b2?.currentStepId === srcTambur, String(b2?.currentStepId));

  // ── Yeni WO: hedef renk B, splitFrom = kaynak, kendi kartı, boyahane ACTIVE. ──
  const newWo = await prisma.workOrder.findUnique({ where: { id: newWoId }, select: { targetColorId: true, splitFromId: true, status: true } });
  check("Yeni WO targetColor = Renk B", newWo?.targetColorId === colorB.id);
  check("Yeni WO splitFrom = kaynak", newWo?.splitFromId === wo.id);
  check("Yeni WO boyahane adımı ACTIVE (born1 orada)", newBoya?.status === "ACTIVE", String(newBoya?.status));
  const newCard = await prisma.travelerCard.count({ where: { workOrderId: newWoId, status: "ACTIVE" } });
  check("Yeni WO kendi refakat kartını aldı", newCard >= 1, `${newCard}`);

  // ── NEW_COLOR yeni sevk (dispatch) AÇMAZ — born1 boyahane adımında bekler,
  //    henüz fasona sevk edilmedi (renk kabulde uygulanır). Gerçeği DB'den doğrula. ──
  const newWoDispatchCount = await prisma.subcontractorDispatch.count({ where: { workOrderId: newWoId } });
  check("Yeni WO'ya HİÇ fason sevki açılmadı (NEW_COLOR sevk açmaz)", newWoDispatchCount === 0, `${newWoDispatchCount} sevk`);
  const born1DispatchCount = await prisma.subcontractorDispatch.count({ where: { batchId: b1!.batchId! } });
  check("born1'in yeni partisinde açık sevk yok", born1DispatchCount === 0, `${born1DispatchCount} sevk`);

  // ── Kaynak WO: born2 canlı → WO hâlâ IN_PROGRESS (B1 tetiklenmez). ──
  const srcWo = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } });
  check("Kaynak WO hâlâ IN_PROGRESS (born2 duruyor)", srcWo?.status === WorkOrderStatus.IN_PROGRESS, String(srcWo?.status));

  console.log(`\n──────────────────────────────────────────`);
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const batches = await prisma.batch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    // Born toplar barcode=null → parentReceiptId / batchId ile yakala (barcode prefix yalnız orijinalleri tutar).
    const rolls = await prisma.roll.findMany({
      where: { OR: [
        { batchId: { in: batchIds } },
        { parentReceiptId: { in: receiptIds } },
        { barcode: { startsWith: "TST-SPR-" } },
      ] },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);

    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
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
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...dispatchIds, ...receiptIds, ...batchIds, ...rollIds] } } });
    // Parti + WO soy bağı (splitFromId self-FK): çocukları önce sil.
    await prisma.batch.deleteMany({ where: { id: { in: batchIds }, splitFromId: { not: null } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds }, splitFromId: { not: null } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
