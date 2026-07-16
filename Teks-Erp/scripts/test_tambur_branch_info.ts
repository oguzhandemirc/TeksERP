// Tambur liste parti zenginleştirmesi (buildBranchInfoMap) regresyon testi.
// Çalıştırma:  npx tsx scripts/test_tambur_branch_info.ts
// Test verisi üzerinde çalışır; ürettiği tüm kayıtları sonunda temizler.
//
// Arka plan: buildBranchInfoMap eski batchSplitId kalıntısıyla batchId'yi
// DISPATCH id'siyle karşılaştırıyordu → eşleşme daima boş, mobil Tambur
// listesinde dispatchNo/batchNumber/branchOrdinal hep null geliyordu.
//
// Doğrulananlar (getStep → loadTamburRolls → buildBranchInfoMap ortak yolu):
//   1. Sevkli partinin topunda batchNumber DOLU (Batch.batchNumber).
//   2. dispatchNo = partinin İPTAL EDİLMEMİŞ EN GÜNCEL sevki
//      (daha yeni ama iptal edilmiş sevk atlanır; eski açık sevk seçilmez).
//   3. branchOrdinal = WO'nun TÜM partileri içinde createdAt sırası (1-based)
//      — Tambur listesinde topu olmayan parti de sayılır (stabil numara).
//   4. Sevksiz partide batchNumber/ordinal DOLU ama dispatchNo null.
//   5. Partisiz (batchId=null) topta üç alan da null.

import {
  RollEntrySource,
  RollStatus,
  StationKind,
  StationType,
  StepStatus,
} from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";

const tambur = new TamburService();

const createdRolls: string[] = [];
const createdDispatches: string[] = [];
const createdBatches: string[] = [];
const createdSteps: string[] = [];
const createdWOs: string[] = [];
let createdSubcontractorId: string | null = null;
let createdStationId: string | null = null;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function rnd() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function firstActiveItemId(): Promise<string> {
  const item = await prisma.item.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok (önce npm run seed).");
  return item.id;
}

async function makeRollOnStep(
  itemId: string,
  stepId: string,
  batchId: string | null,
) {
  const roll = await prisma.roll.create({
    data: {
      barcode: null, // açık kumaş
      itemId,
      colorId: null,
      width: 150,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.IN_PRODUCTION,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
      currentStepId: stepId,
      batchId,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  // loadTamburRolls açık RollMovement üzerinden listeler.
  await prisma.rollMovement.create({
    data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: 100 },
  });
  return roll.id;
}

async function main() {
  console.log("=== Tambur Parti Bilgisi (buildBranchInfoMap) Testi ===\n");
  const itemId = await firstActiveItemId();
  const now = Date.now();

  // ── Fixture: TAMBUR istasyonu + WO + tambur adımı ──
  let station = await prisma.station.findFirst({
    where: { kind: StationKind.TAMBUR },
    select: { id: true },
  });
  if (!station) {
    const s = await prisma.station.create({
      data: {
        code: `TEST-BI-TAMBUR-${rnd()}`,
        name: "Test Tambur",
        type: StationType.INTERNAL,
        kind: StationKind.TAMBUR,
      },
      select: { id: true },
    });
    createdStationId = s.id;
    station = s;
  }
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-BI-WO-${rnd()}`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  createdWOs.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: {
      workOrderId: wo.id,
      stationId: station.id,
      stepSequence: 1,
      status: StepStatus.ACTIVE,
    },
    select: { id: true },
  });
  createdSteps.push(step.id);

  // ── Partiler: Z (Tambur'da topu YOK) < A (sevkli) < B (sevksiz) ──
  // createdAt explicit → ordinal deterministik: Z=1, A=2, B=3.
  const makeBatch = async (tag: string, createdAt: Date) => {
    const b = await prisma.batch.create({
      data: {
        batchNumber: `TEST-BI-P${tag}-${rnd()}`,
        workOrderId: wo.id,
        createdAt,
      },
      select: { id: true, batchNumber: true },
    });
    createdBatches.push(b.id);
    return b;
  };
  const batchZ = await makeBatch("Z", new Date(now - 30_000));
  const batchA = await makeBatch("A", new Date(now - 20_000));
  const batchB = await makeBatch("B", new Date(now - 10_000));

  // ── Fason firma + parti A'nın sevkleri ──
  const sub = await prisma.subcontractor.create({
    data: { code: `TEST-BI-SUB-${rnd()}`, name: "Test Fason (branch-info)" },
    select: { id: true },
  });
  createdSubcontractorId = sub.id;

  const makeDispatch = async (
    tag: string,
    dispatchedAt: Date,
    cancelledAt: Date | null,
  ) => {
    const d = await prisma.subcontractorDispatch.create({
      data: {
        dispatchNo: `TEST-BI-D${tag}-${rnd()}`,
        workOrderId: wo.id,
        batchId: batchA.id,
        stepId: step.id,
        subcontractorId: sub.id,
        dispatchedAt,
        cancelledAt,
        ...(cancelledAt ? { cancelReason: "test iptali" } : {}),
      },
      select: { id: true, dispatchNo: true },
    });
    createdDispatches.push(d.id);
    return d;
  };
  await makeDispatch("1-ESKI", new Date(now - 3 * 3600_000), null); // eski, açık
  const d2 = await makeDispatch("2-GUNCEL", new Date(now - 3600_000), null); // EN GÜNCEL iptal edilmemiş
  await makeDispatch("3-IPTAL", new Date(now - 600_000), new Date(now - 300_000)); // daha yeni ama İPTAL

  // ── Tambur adımında bekleyen toplar ──
  const rollA = await makeRollOnStep(itemId, step.id, batchA.id); // sevkli parti
  const rollB = await makeRollOnStep(itemId, step.id, batchB.id); // sevksiz parti
  const rollC = await makeRollOnStep(itemId, step.id, null); // partisiz top

  // ── getStep → zenginleştirilmiş liste ──
  const res = await tambur.getStep(step.id);
  const rolls = res.data.rolls;
  check("liste 3 top döndü", rolls.length === 3, `n=${rolls.length}`);

  const byId = new Map(rolls.map((r) => [r.rollId, r]));
  const a = byId.get(rollA);
  const b = byId.get(rollB);
  const c = byId.get(rollC);

  // 1-3. Sevkli parti (A)
  check(
    "sevkli parti: batchNumber DOLU (Batch.batchNumber)",
    a?.batchNumber === batchA.batchNumber,
    `batchNumber=${a?.batchNumber}`,
  );
  check(
    "sevkli parti: dispatchNo = iptal edilmemiş EN GÜNCEL sevk (iptal olan atlandı)",
    a?.dispatchNo === d2.dispatchNo,
    `dispatchNo=${a?.dispatchNo} beklenen=${d2.dispatchNo}`,
  );
  check(
    "sevkli parti: branchOrdinal WO'nun TÜM partileri içinde createdAt sırası (Z=1 → A=2)",
    a?.branchOrdinal === 2,
    `ordinal=${a?.branchOrdinal}`,
  );

  // 4. Sevksiz parti (B)
  check(
    "sevksiz parti: batchNumber DOLU",
    b?.batchNumber === batchB.batchNumber,
    `batchNumber=${b?.batchNumber}`,
  );
  check("sevksiz parti: dispatchNo null", b?.dispatchNo === null, `dispatchNo=${b?.dispatchNo}`);
  check("sevksiz parti: branchOrdinal = 3", b?.branchOrdinal === 3, `ordinal=${b?.branchOrdinal}`);

  // 5. Partisiz top (batchId=null)
  check(
    "partisiz top: batchNumber/dispatchNo/branchOrdinal üçü de null",
    c?.batchId === null &&
      c?.batchNumber === null &&
      c?.dispatchNo === null &&
      c?.branchOrdinal === null,
    `batchId=${c?.batchId} batchNumber=${c?.batchNumber} dispatchNo=${c?.dispatchNo} ordinal=${c?.branchOrdinal}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup() {
  if (createdRolls.length) {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
  }
  if (createdDispatches.length) {
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: createdDispatches } } }).catch(() => {});
  }
  if (createdBatches.length) {
    await prisma.batch.deleteMany({ where: { id: { in: createdBatches } } }).catch(() => {});
  }
  if (createdSteps.length) {
    await prisma.workOrderStep.deleteMany({ where: { id: { in: createdSteps } } }).catch(() => {});
  }
  if (createdWOs.length) {
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWOs } } }).catch(() => {});
  }
  if (createdSubcontractorId) {
    await prisma.subcontractor.deleteMany({ where: { id: createdSubcontractorId } }).catch(() => {});
  }
  if (createdStationId) {
    await prisma.station.deleteMany({ where: { id: createdStationId } }).catch(() => {});
  }
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => {
    console.error("Test hatası:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
