// TEST: Fason kabul born-roll SAYI sözleşmesi (saha bug'ı + düzeltme + sınır senaryolar).
//
// Saha notu: Boyahaneye 1 sevk/2 top; kabul İKİ SEFERDE (önce 1, sonra 1). KK2/Kurşun'a
// 2 yerine 3 top geçti. Kök: receive() her kabulde data.newRolls.length kadar açık-kumaş
// Roll doğurur; bu sayı returns'e BAĞLI DEĞİLDİR (KASITLI — boyahane merge/split yapabilir).
// Eski mobil ekran newRolls'u partinin TÜM topundan ön-doldurup ✓ kaldırmaya bağlamıyordu.
//
// Bu test backend doğum sözleşmesini gerçek DB ile kilitler:
//   A (BUG)   rcv1 returns=[1]+newRolls=[2] · rcv2 returns=[1]+newRolls=[1] → KK2'de 3 (saha)
//   B (FIX)   rcv1 returns=[1]+newRolls=[1] · rcv2 returns=[1]+newRolls=[1] → KK2'de 2
//   C (MERGE) tek rcv returns=[1,2]+newRolls=[1]                            → KK2'de 1
//   D (SPLIT) tek rcv returns=[1]+newRolls=[2]                              → KK2'de 2
//   E (3 TOP) 3 ayrı kısmi kabul (1+1+1)                                    → KK2'de 3 (birikim)
//   F (SON ADIM) nextStep yok → born roll WAREHOUSE final + barkod + currentStepId null
//   G (VALIDATION) qty≤0 / outstanding-olmayan / mükerrer / INTERNAL adım  → hepsi AppError
//
// Rota: [1] BOYA_FASON (EXTERNAL) → [2] KURSUN_KK2 (INTERNAL)   (F'de tek adım)
// Çalıştır: npx tsx scripts/test_fason_partial_receive_overcount.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, RollForm, StepStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

let ITEM = "";
let GRADE = "";
let GRADE_CODE = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_KURSUN = "";
let SUB_BOYER = "";
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
async function checkThrows(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fail++;
    console.log(`  ✗ FAIL: ${label} — HATA BEKLENİYORDU ama geçti`);
  } catch (e) {
    pass++;
    console.log(`  ✓ ${label} — reddedildi: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-FPR-${rand}${bc}`;
}

const createdWoIds: string[] = [];
const allStepIds: string[] = [];

async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(),
      qualityGrade: GRADE_CODE,
      qualityGradeId: GRADE,
      width: WIDTH,
      createdById: ADMIN,
    },
  });
  return r.id;
}

interface Scenario {
  woId: string;
  boyaStep: string;
  kursunStep: string | null; // withNextStep=false ise null
  rollIds: string[];
}

// 1 WO + N stok top + hepsini Boyahane'ye sevk. withNextStep: KURSUN_KK2 adımı eklensin mi.
async function setupWo(tag: string, rollQtys: number[], withNextStep = true): Promise<Scenario> {
  const stamp = `${Date.now()}`.slice(-6);
  const stepCreate = [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" as const }];
  if (withNextStep) stepCreate.push({ stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" as const });
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-FPR-${tag}-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: { create: stepCreate },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.push(wo.id);
  const boyaStep = wo.steps[0].id;
  const kursunStep = withNextStep ? wo.steps[1].id : null;
  allStepIds.push(boyaStep);
  if (kursunStep) allStepIds.push(kursunStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  const rollIds: string[] = [];
  for (const q of rollQtys) rollIds.push(await stockRoll(q));
  await sub.dispatch(
    { workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds },
    ADMIN,
  );
  return { woId: wo.id, boyaStep, kursunStep, rollIds };
}

// Fasondan doğmuş (born) açık-kumaş top sayısı. nextStep varsa Kurşun'da IN_PRODUCTION,
// yoksa FİNAL depoda (fason son adım → currentStepId null + WAREHOUSE).
async function bornCount(s: Scenario): Promise<number> {
  if (s.kursunStep) {
    return prisma.roll.count({
      where: {
        parentReceipt: { workOrderId: s.woId },
        parentRollId: null,
        currentStepId: s.kursunStep,
        status: RollStatus.IN_PRODUCTION,
      },
    });
  }
  return prisma.roll.count({
    where: {
      parentReceipt: { workOrderId: s.woId },
      parentRollId: null,
      currentStepId: null,
      status: RollStatus.WAREHOUSE,
    },
  });
}

function stepStatus(steps: { id: string; status: StepStatus }[], id: string): StepStatus {
  return steps.find((x) => x.id === id)!.status;
}
async function boyaStatus(s: Scenario): Promise<StepStatus> {
  const st = await prisma.workOrderStep.findUnique({ where: { id: s.boyaStep }, select: { status: true } });
  return st!.status;
}

async function main(): Promise<void> {
  await resolveFixtures();

  // ═══ SENARYO A — SAHA BUG'INI YENİDEN ÜRET (eski ekranın payload'ı) ═══
  console.log("\n=== SENARYO A: BUG REPRODUKSİYONU (1 top geldi → eski ekran 2 parça gönderir) ===");
  const a = await setupWo("A", [300, 300]);
  const aDisp = await prisma.roll.findMany({ where: { id: { in: a.rollIds } }, select: { status: true, currentStepId: true } });
  check("A: sevk sonrası 2 top AT_SUBCONTRACTOR @ Boyahane",
    aDisp.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR && r.currentStepId === a.boyaStep));

  await sub.receive(
    { workOrderId: a.woId, stepId: a.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: a.rollIds[0] }], newRolls: [{ qty: 290 }, { qty: 285 }] }, // ← BUG payload
    ADMIN);
  const aAfter1 = await prisma.roll.findMany({ where: { id: { in: a.rollIds } }, select: { id: true, status: true } });
  check("A: ilk kabul sonrası r1 CONSUMED, r2 hâlâ AT_SUBCONTRACTOR (kısmi)",
    aAfter1.find((r) => r.id === a.rollIds[0])?.status === RollStatus.SUBCONTRACTOR_CONSUMED &&
    aAfter1.find((r) => r.id === a.rollIds[1])?.status === RollStatus.AT_SUBCONTRACTOR);
  check("A: Boyahane hâlâ ACTIVE (r2 dönmedi)", (await boyaStatus(a)) === StepStatus.ACTIVE);
  check("A: ilk kabulde 2 born roll (1 top geldi ama 2 parça) — 'ilk partiyi 2 gördü'",
    (await bornCount(a)) === 2, `kurşunda ${await bornCount(a)}`);

  await sub.receive(
    { workOrderId: a.woId, stepId: a.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: a.rollIds[1] }], newRolls: [{ qty: 295 }] }, ADMIN);
  check("A: SAHA BUG'I — 2 fiziksel top için kurşuna 3 top geçti",
    (await bornCount(a)) === 3, `kurşunda ${await bornCount(a)} (beklenen bug: 3)`);
  check("A: tüm toplar dönünce Boyahane COMPLETED", (await boyaStatus(a)) === StepStatus.COMPLETED);

  // ═══ SENARYO B — DÜZELTİLMİŞ EKRANIN PAYLOAD'I ═══
  console.log("\n=== SENARYO B: DÜZELTME KANITI (gelen top kadar parça) ===");
  const b = await setupWo("B", [300, 300]);
  await sub.receive({ workOrderId: b.woId, stepId: b.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: b.rollIds[0] }], newRolls: [{ qty: 290 }] }, ADMIN);
  check("B: ilk kabulde 1 born roll (gelen kadar parça)", (await bornCount(b)) === 1, `kurşunda ${await bornCount(b)}`);
  await sub.receive({ workOrderId: b.woId, stepId: b.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: b.rollIds[1] }], newRolls: [{ qty: 295 }] }, ADMIN);
  check("B: DÜZELTME — kurşuna tam 2 top", (await bornCount(b)) === 2, `kurşunda ${await bornCount(b)} (beklenen: 2)`);

  // ═══ SENARYO C — MEŞRU MERGE (2 top tek kabulde 1 parçaya) ═══
  console.log("\n=== SENARYO C: MEŞRU MERGE (2 top → 1 parça) ===");
  const c = await setupWo("C", [300, 300]);
  await sub.receive({ workOrderId: c.woId, stepId: c.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: c.rollIds[0] }, { rollId: c.rollIds[1] }], newRolls: [{ qty: 560 }] }, ADMIN);
  check("C: merge — 2 top tek kabulde 1 parça (backend izin verir)", (await bornCount(c)) === 1, `kurşunda ${await bornCount(c)} (beklenen: 1)`);
  check("C: merge sonrası Boyahane COMPLETED", (await boyaStatus(c)) === StepStatus.COMPLETED);

  // ═══ SENARYO D — MEŞRU SPLIT (1 top tek kabulde 2 parçaya) ═══
  console.log("\n=== SENARYO D: MEŞRU SPLIT (1 top → 2 parça) ===");
  const d = await setupWo("D", [300]);
  await sub.receive({ workOrderId: d.woId, stepId: d.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: d.rollIds[0] }], newRolls: [{ qty: 150 }, { qty: 145 }] }, ADMIN);
  check("D: split — 1 top tek kabulde 2 parça (backend izin verir)", (await bornCount(d)) === 2, `kurşunda ${await bornCount(d)} (beklenen: 2)`);
  check("D: split sonrası Boyahane COMPLETED (tek top tüketildi)", (await boyaStatus(d)) === StepStatus.COMPLETED);

  // ═══ SENARYO E — 3 TOP, 3 AYRI KISMİ KABUL (birikim doğru) ═══
  console.log("\n=== SENARYO E: 3 top, 3 ayrı kısmi kabul (1+1+1) ===");
  const e = await setupWo("E", [300, 300, 300]);
  await sub.receive({ workOrderId: e.woId, stepId: e.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: e.rollIds[0] }], newRolls: [{ qty: 290 }] }, ADMIN);
  check("E: 1. kabul → 1 born", (await bornCount(e)) === 1);
  check("E: 1. kabul sonrası Boyahane hâlâ ACTIVE", (await boyaStatus(e)) === StepStatus.ACTIVE);
  await sub.receive({ workOrderId: e.woId, stepId: e.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: e.rollIds[1] }], newRolls: [{ qty: 295 }] }, ADMIN);
  check("E: 2. kabul → 2 born (birikim)", (await bornCount(e)) === 2);
  await sub.receive({ workOrderId: e.woId, stepId: e.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: e.rollIds[2] }], newRolls: [{ qty: 298 }] }, ADMIN);
  check("E: 3. kabul → tam 3 born (fazla yok)", (await bornCount(e)) === 3, `kurşunda ${await bornCount(e)}`);
  check("E: tüm toplar dönünce Boyahane COMPLETED", (await boyaStatus(e)) === StepStatus.COMPLETED);

  // ═══ SENARYO F — SON ADIM (nextStep null) → FİNAL depo (WAREHOUSE + barkod, form ACIK) ═══
  console.log("\n=== SENARYO F: fason son adım (nextStep yok) → born roll FİNAL depoda ===");
  const f = await setupWo("F", [300], /*withNextStep*/ false);
  await sub.receive({ workOrderId: f.woId, stepId: f.boyaStep, subcontractorId: SUB_BOYER,
    returns: [{ rollId: f.rollIds[0] }], newRolls: [{ qty: 295 }] }, ADMIN);
  check("F: nextStep yok → 1 born roll DEPODA (WAREHOUSE + currentStepId null)", (await bornCount(f)) === 1, `depoda ${await bornCount(f)}`);
  const fBorn = await prisma.roll.findFirst({
    where: { parentReceipt: { workOrderId: f.woId }, parentRollId: null },
    select: { status: true, currentStepId: true, producedInStepId: true, barcode: true, form: true },
  });
  check("F: born roll WAREHOUSE (final)", fBorn?.status === RollStatus.WAREHOUSE, String(fBorn?.status));
  check("F: born roll barkod üretildi (her kumaşa etiket)", !!fBorn?.barcode, String(fBorn?.barcode));
  check("F: born roll form ACIK", fBorn?.form === RollForm.ACIK, String(fBorn?.form));
  check("F: born roll currentStepId null (final serbest)", fBorn?.currentStepId === null);
  check("F: born roll producedInStepId = Boyahane", fBorn?.producedInStepId === f.boyaStep);

  // ═══ SENARYO G — VALIDATION GUARD'LARI ═══
  console.log("\n=== SENARYO G: validation guard'ları (doğum olmamalı) ===");
  const g = await setupWo("G", [300, 300]);
  const freeStock = await stockRoll(100); // bu adıma sevk EDİLMEMİŞ serbest top
  await checkThrows("G1: newRolls qty=0 reddedilir", () =>
    sub.receive({ workOrderId: g.woId, stepId: g.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: g.rollIds[0] }], newRolls: [{ qty: 0 }] }, ADMIN));
  await checkThrows("G2: bu adımda fasonda olmayan top reddedilir", () =>
    sub.receive({ workOrderId: g.woId, stepId: g.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: freeStock }], newRolls: [{ qty: 50 }] }, ADMIN));
  await checkThrows("G3: returns'te mükerrer rollId reddedilir", () =>
    sub.receive({ workOrderId: g.woId, stepId: g.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: g.rollIds[0] }, { rollId: g.rollIds[0] }], newRolls: [{ qty: 50 }] }, ADMIN));
  if (g.kursunStep) {
    await checkThrows("G4: INTERNAL (Kurşun) adıma receive reddedilir", () =>
      sub.receive({ workOrderId: g.woId, stepId: g.kursunStep!, subcontractorId: SUB_BOYER,
        returns: [{ rollId: g.rollIds[0] }], newRolls: [{ qty: 50 }] }, ADMIN));
  }
  // Guard'lardan sonra hiçbir top tüketilmemiş + hiç born yok olmalı (tx rollback / pre-tx reddi)
  const gRolls = await prisma.roll.findMany({ where: { id: { in: g.rollIds } }, select: { status: true } });
  check("G: guard'lardan sonra toplar hâlâ AT_SUBCONTRACTOR (tüketilmedi)",
    gRolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR));
  check("G: guard'lardan sonra hiç born roll doğmadı", (await bornCount(g)) === 0);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: allStepIds } },
          { producedInStepId: { in: allStepIds } },
          { parentReceipt: { workOrderId: { in: createdWoIds } } },
          { barcode: { startsWith: "TST-FPR-" } },
        ],
      },
      select: { id: true },
    });
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
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
