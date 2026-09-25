// TEST: Fason kabul İPTALİ + yeniden kabul — born-roll sayı bütünlüğü.
//
// Saha bug'ı sınıfı = yanlış born-roll sayısı. Kabul iptali bu sınıfın kritik bir
// koludur: iptal born roll'u CANCELLED'a çekip orijinali AT_SUBCONTRACTOR'a geri
// vermeli; sonra yeniden kabul TAM 1 canlı born üretmeli (öksüz/çift olmamalı).
// Ayrıca işlenmiş (downstream'i olan) born roll'un kabulü iptal EDİLEMEMELİ.
//
//   CR1: rcv(1 top, 1 parça) → cancel → born CANCELLED + orijinal geri → re-rcv → tam 1 canlı
//   CR2: rcv(1 top) → born sonraki istasyona "geçmiş" işaretle → cancel REDDEDİLİR (sayı bozulmaz)
//
// Rota: [1] BOYA_FASON (EXTERNAL) → [2] KURSUN_KK2 (INTERNAL)
// Çalıştır: npx tsx scripts/test_fason_receive_cancel_rereceive.ts
import prisma from "../src/lib/prisma";
import { iptalAktoruIddiasi, kapaliHareketFotografi, tersKayitIddialari } from "./lib/hareket-ters-kayit";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ACTIVE_MOVEMENT } from "../src/services/helpers/roll-movement.helper";
import { RollStatus, StepStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "", SUB_BOYER = "";
let GRADE_CODE = "";
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
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "Station KURSUN_KK2");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function checkThrows(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); fail++; console.log(`  ✗ FAIL: ${label} — HATA BEKLENİYORDU ama geçti`); }
  catch (e) { pass++; console.log(`  ✓ ${label} — reddedildi: ${e instanceof Error ? e.message : String(e)}`); }
}

let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-FCR-${rand}${bc}`;
}

const createdWoIds: string[] = [];
const allStepIds: string[] = [];

async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN },
  });
  return r.id;
}

interface Scenario { woId: string; boyaStep: string; kursunStep: string; rollIds: string[]; }

async function setupWo(tag: string, rollQtys: number[]): Promise<Scenario> {
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-FCR-${tag}-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
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
  for (const q of rollQtys) rollIds.push(await stockRoll(q));
  await sub.dispatch({ workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
  return { woId: wo.id, boyaStep, kursunStep, rollIds };
}

// Canlı (IN_PRODUCTION @ kursun) born sayısı
async function bornLive(s: Scenario): Promise<number> {
  return prisma.roll.count({ where: { parentReceipt: { workOrderId: s.woId }, parentRollId: null, currentStepId: s.kursunStep, status: RollStatus.IN_PRODUCTION } });
}
// Tüm born (her statü) — öksüz/çift kontrolü
async function bornTotal(s: Scenario): Promise<number> {
  return prisma.roll.count({ where: { parentReceipt: { workOrderId: s.woId }, parentRollId: null } });
}
async function latestBorn(s: Scenario): Promise<{ id: string; parentReceiptId: string | null; status: RollStatus; currentStepId: string | null }> {
  const r = await prisma.roll.findFirst({
    where: { parentReceipt: { workOrderId: s.woId }, parentRollId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, parentReceiptId: true, status: true, currentStepId: true },
  });
  if (!r) throw new Error("born roll bulunamadı");
  return r;
}
async function boyaStatus(s: Scenario): Promise<StepStatus> {
  const st = await prisma.workOrderStep.findUnique({ where: { id: s.boyaStep }, select: { status: true } });
  return st!.status;
}

async function main(): Promise<void> {
  await resolveFixtures();

  // ═══ CR1 — İPTAL → GERİ AL → YENİDEN KABUL ═══
  console.log("\n=== CR1: kabul iptali → orijinal geri → yeniden kabul (tam 1 canlı born) ===");
  const a = await setupWo("CR1", [300, 300]);
  await sub.receive({ workOrderId: a.woId, stepId: a.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: a.rollIds[0] }], newRolls: [{ qty: 290 }] }, ADMIN);
  const born1 = await latestBorn(a);
  check("CR1: ilk kabulde 1 canlı born @ Kurşun", (await bornLive(a)) === 1 && born1.status === RollStatus.IN_PRODUCTION && born1.currentStepId === a.kursunStep);
  check("CR1: ilk kabul sonrası Boyahane ACTIVE (r2 dışarıda)", (await boyaStatus(a)) === StepStatus.ACTIVE);

  // Born'a bir özellik yaz — iptal ÖZELLİĞİ SİLMEMELİ (③a ticari pivot, 2026-09-14):
  // top CANCELLED'a gider, satırı onunla kalır. Fikstür doğrudan yazar (inheritance
  // değil, sitenin kendisi ölçülüyor).
  // Fikstür İŞ ANAHTARIYLA (code) kurulur, ortamda aranmaz (keyfi arama mandalı).
  const anyProp = await prisma.fabricProperty.upsert({
    where: { code: "TEST-FCR-OLU-OZ" },
    create: { code: "TEST-FCR-OLU-OZ", name: "TEST ölü top özelliği", valueType: "FLAG" },
    update: {}, select: { id: true },
  });
  await prisma.rollProperty.upsert({
    where: { rollId_propertyId: { rollId: born1.id, propertyId: anyProp.id } },
    create: { rollId: born1.id, propertyId: anyProp.id }, update: {},
  });
  const born1PropsBefore = await prisma.rollProperty.count({ where: { rollId: born1.id } });
  check("ön koşul — born1'de özellik satırı var", born1PropsBefore >= 1, `n=${born1PropsBefore}`);

  const fotoKabul = await kapaliHareketFotografi(prisma, { rollId: a.rollIds[0], workOrderStepId: a.boyaStep });
  await sub.cancelReceipt(born1.parentReceiptId!, "saha testi: kabul iptali", ADMIN, [born1.id]);
  for (const [e, ok, d] of await tersKayitIddialari(prisma, fotoKabul, "FASON_KABUL_IPTAL")) check(`CR1: hareket: ${e}`, ok, d);
  { const [e, ok, d] = await iptalAktoruIddiasi(prisma, [born1.id], ADMIN); check(`CR1: ${e}`, ok, d); }
  const born1PropsAfterRows = await prisma.rollProperty.findMany({ where: { rollId: born1.id }, select: { revokedAt: true, revokeReason: true } });
  check("CR1: ⭐ iptal born'un ÖZELLİK satırını SİLMEDİ (ölü topta kalır)", born1PropsAfterRows.length === born1PropsBefore, `önce=${born1PropsBefore} sonra=${born1PropsAfterRows.length}`);
  check("CR1: ⭐ özellik satırı DAMGALI, sebep kardeş hareketle aynı (FASON_RECEIPT_CANCEL)",
    born1PropsAfterRows.every((p) => p.revokedAt !== null && p.revokeReason === "FASON_RECEIPT_CANCEL"),
    JSON.stringify(born1PropsAfterRows.map((p) => p.revokeReason)));
  const born1After = await prisma.roll.findUnique({ where: { id: born1.id }, select: { status: true, currentStepId: true } });
  check("CR1: iptal → born roll CANCELLED + currentStepId null", born1After?.status === RollStatus.CANCELLED && born1After?.currentStepId === null);
  const r1After = await prisma.roll.findUnique({ where: { id: a.rollIds[0] }, select: { status: true, currentStepId: true } });
  check("CR1: iptal → orijinal r1 AT_SUBCONTRACTOR @ Boyahane geri döndü", r1After?.status === RollStatus.AT_SUBCONTRACTOR && r1After?.currentStepId === a.boyaStep);
  const receiptAfter = await prisma.subcontractorReceipt.findUnique({ where: { id: born1.parentReceiptId! }, select: { cancelledAt: true } });
  check("CR1: receipt.cancelledAt set", !!receiptAfter?.cancelledAt);
  check("CR1: iptal sonrası canlı born = 0", (await bornLive(a)) === 0);
  // Kabul iptali born'un açık-kumaş hareketini SİLMEZ, damgalar (defter doktrini).
  const born1MvAktif = await prisma.rollMovement.count({ where: { ...ACTIVE_MOVEMENT, rollId: born1.id, workOrderStepId: a.kursunStep } });
  const born1MvDamgali = await prisma.rollMovement.count({ where: { rollId: born1.id, workOrderStepId: a.kursunStep, revokedAt: { not: null } } });
  check("CR1: iptal → born'un Kurşun hareketi GERİ ALINDI (aktif 0)", born1MvAktif === 0, `aktif=${born1MvAktif}`);
  check("CR1: ⭐ hareket izi SİLİNMEDİ, defterde damgalı duruyor", born1MvDamgali > 0, `damgalı=${born1MvDamgali}`);

  // Yeniden kabul (cancelledAt:null idempotency filtresi sayesinde cached SANILMAZ)
  await sub.receive({ workOrderId: a.woId, stepId: a.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: a.rollIds[0] }], newRolls: [{ qty: 295 }] }, ADMIN);
  check("CR1: yeniden kabul → TAM 1 canlı born (çift/öksüz yok)", (await bornLive(a)) === 1, `canlı ${await bornLive(a)}`);
  check("CR1: toplam born = 2 (1 iptal + 1 canlı), şişme yok", (await bornTotal(a)) === 2, `toplam ${await bornTotal(a)}`);

  // ═══ CR2 — İŞLENMİŞ BORN ROLL'UN KABULÜ İPTAL EDİLEMEZ ═══
  console.log("\n=== CR2: downstream'i olan born roll → iptal REDDEDİLİR (sayı bozulmaz) ===");
  const b = await setupWo("CR2", [300]);
  await sub.receive({ workOrderId: b.woId, stepId: b.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: b.rollIds[0] }], newRolls: [{ qty: 290 }] }, ADMIN);
  const born2 = await latestBorn(b);
  // Born roll'u "sonraki istasyona geçmiş" işaretle (movement exitedAt) → blockingReason
  await prisma.rollMovement.updateMany({ where: { ...ACTIVE_MOVEMENT, rollId: born2.id, workOrderStepId: b.kursunStep }, data: { exitedAt: new Date() } });
  await checkThrows("CR2: işlenmiş born roll'lu receipt iptali reddedilir", () =>
    sub.cancelReceipt(born2.parentReceiptId!, "iptal denemesi", ADMIN, [born2.id]));
  const born2After = await prisma.roll.findUnique({ where: { id: born2.id }, select: { status: true } });
  check("CR2: red sonrası born roll hâlâ IN_PRODUCTION (iptal olmadı)", born2After?.status === RollStatus.IN_PRODUCTION);
  const receipt2 = await prisma.subcontractorReceipt.findUnique({ where: { id: born2.parentReceiptId! }, select: { cancelledAt: true } });
  check("CR2: red sonrası receipt cancelledAt boş (iptal olmadı)", !receipt2?.cancelledAt);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: { OR: [
        { currentStepId: { in: allStepIds } },
        { producedInStepId: { in: allStepIds } },
        { parentReceipt: { workOrderId: { in: createdWoIds } } },
        { barcode: { startsWith: "TST-FCR-" } },
      ] }, select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.fabricProperty.deleteMany({ where: { code: "TEST-FCR-OLU-OZ" } }).catch(() => {});
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
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
