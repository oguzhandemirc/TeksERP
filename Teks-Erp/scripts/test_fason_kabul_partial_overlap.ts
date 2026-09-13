// TEST: Fason kabul idempotency guard'ı — kısmi-örtüşme asimetri düzeltmesi
// (İdempotency denetimi Faz 3). Eski KESİŞİM guard'ı kısmi örtüşen payload'da sahte
// başarı dönüp yeni topu SESSİZCE atlıyordu; artık TAM-küme eşitliği (dispatch
// sameRolls ile simetrik).
//
//   PO1 Tam-küme replay   : {R0} kabul → {R0} tekrar → cached (mevcut davranış korunur)
//   PO2 Kısmi örtüşme      : {R0} kabul → {R0,R1} → cached DÖNMEZ; atomik claim net 409
//                            (R0 artık AT_SUBCONTRACTOR değil) — R1 kurtarılabilir
//   PO3 Ayrık küme         : {R1} tek başına → guard tetiklenmez, normal kabul
//
// Çalıştır: npx tsx scripts/test_fason_kabul_partial_overlap.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, code: number, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
  } catch (e) {
    const sc = (e as { statusCode?: number }).statusCode;
    check(label, sc === code, `statusCode ${sc}`);
  }
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const ts = Date.now();
let ITEM = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "", SUB_BOYER = "";
const createdWoIds: string[] = [];
const allStepIds: string[] = [];
let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-FPO-${rand}${bc}`;
}

async function bornLive(woId: string, kursunStep: string): Promise<number> {
  return prisma.roll.count({ where: { parentReceipt: { workOrderId: woId }, parentRollId: null, currentStepId: kursunStep, status: RollStatus.IN_PRODUCTION } });
}
async function activeReceiptCount(woId: string): Promise<number> {
  return prisma.subcontractorReceipt.count({ where: { workOrderId: woId, cancelledAt: null } });
}

async function setup(tag: string, count: number): Promise<{ woId: string; boyaStep: string; kursunStep: string; rollIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `IE-FPO-${tag}-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
        { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.push(wo.id);
  const boyaStep = wo.steps[0].id, kursunStep = wo.steps[1].id;
  allStepIds.push(boyaStep, kursunStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const rollIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: 300, currentQty: 300, status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), width: 250, createdById: ADMIN }, select: { id: true } });
    rollIds.push(r.id);
  }
  return { woId: wo.id, boyaStep, kursunStep, rollIds };
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  if (!item || !admin || !boya || !kursun) throw new Error("Seed fixture eksik — önce 'npm run seed'");
  ITEM = item.id; ADMIN = admin.id; ST_BOYA = boya.id; ST_KURSUN = kursun.id; SUB_BOYER = boyer.id;

  // ═══ PO1 — TAM-KÜME REPLAY (mevcut davranış korunur) ═══
  console.log("\n=== PO1: {R0} kabul → {R0} tekrar → cached (tam-küme replay) ===");
  {
    const { woId, boyaStep, kursunStep, rollIds } = await setup("PO1", 2);
    await sub.dispatch({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    const payload = { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] };
    await sub.receive(payload, ADMIN);
    const res2 = await sub.receive(payload, ADMIN); // birebir tam-küme replay
    check("PO1: tam-küme replay cached döner", res2.success === true);
    check("PO1: aktif receipt 1 (ikinci açılmadı)", (await activeReceiptCount(woId)) === 1);
    check("PO1: born 1 (çift doğum yok)", (await bornLive(woId, kursunStep)) === 1);
  }

  // ═══ PO2 — KISMİ ÖRTÜŞME (asimetri düzeltmesi) ═══
  console.log("\n=== PO2: {R0} kabul → {R0,R1} → cached DÖNMEZ; atomik claim net 409 ===");
  {
    const { woId, boyaStep, kursunStep, rollIds } = await setup("PO2", 2);
    await sub.dispatch({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    // R0'ı kabul et (kısmi/partili dönüş).
    await sub.receive({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] }, ADMIN);
    check("PO2: R0 kabul → born 1", (await bornLive(woId, kursunStep)) === 1);
    // Kısmi örtüşen payload {R0,R1}: eski guard sahte başarı dönerdi; artık cached
    // DÖNMEZ → akış ilerler ve tx-öncesi outstanding-kontrolü (R0 artık CONSUMED,
    // AT_SUBCONTRACTOR değil) net 400 "Top zaten dönmüş" ile reddeder (atomik claim'e
    // ulaşmadan; her iki savunma da doğru — pre-tx olan önce tetiklenir).
    await expectErr("PO2: kısmi örtüşme {R0,R1} → cached DEĞİL, net 400", 400, () =>
      sub.receive({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, returns: [{ rollId: rollIds[0] }, { rollId: rollIds[1] }], newRolls: [{ qty: 285 }, { qty: 288 }] }, ADMIN),
    );
    check("PO2: sahte-başarı YOK → born hâlâ 1 (R1 için ikinci doğum olmadı)", (await bornLive(woId, kursunStep)) === 1);
    const r1 = await prisma.roll.findUnique({ where: { id: rollIds[1] }, select: { status: true, currentStepId: true } });
    check("PO2: R1 hâlâ AT_SUBCONTRACTOR @ Boyahane (kurtarılabilir — atlanmadı)",
      r1?.status === RollStatus.AT_SUBCONTRACTOR && r1?.currentStepId === boyaStep);
    // Kurtarma: R1 tek başına kabul → born 2, adım kapanır.
    await sub.receive({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, returns: [{ rollId: rollIds[1] }], newRolls: [{ qty: 288 }] }, ADMIN);
    check("PO2: R1 ayrı kabul ile kurtarıldı → born 2", (await bornLive(woId, kursunStep)) === 2);
  }

  // ═══ PO3 — AYRIK KÜME (guard tetiklenmez) ═══
  console.log("\n=== PO3: {R1} tek başına (R0 kabul edilmemiş) → guard tetiklenmez, normal kabul ===");
  {
    const { woId, boyaStep, kursunStep, rollIds } = await setup("PO3", 2);
    await sub.dispatch({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    // Doğrudan R1'i kabul et (R0 hiç kabul edilmedi) → hiçbir örtüşme yok → normal akış.
    const res = await sub.receive({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, returns: [{ rollId: rollIds[1] }], newRolls: [{ qty: 292 }] }, ADMIN);
    check("PO3: ayrık küme normal kabul (cached değil)", res.success === true);
    check("PO3: R1 için 1 born", (await bornLive(woId, kursunStep)) === 1);
    const r0 = await prisma.roll.findUnique({ where: { id: rollIds[0] }, select: { status: true } });
    check("PO3: R0 dokunulmadı (hâlâ AT_SUBCONTRACTOR)", r0?.status === RollStatus.AT_SUBCONTRACTOR);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: allStepIds } }, { producedInStepId: { in: allStepIds } }, { parentReceipt: { workOrderId: { in: createdWoIds } } }, { barcode: { startsWith: "TST-FPO-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
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
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
