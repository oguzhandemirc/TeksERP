// Fason sevk "Top Seç" picker filtre testi: filter[dispatchableForStepId].
// Çalıştırma:  npx ts-node scripts/test_fason_dispatch_picker.ts
// Test verisi üzerinde çalışır; ürettiği roll/step/WO'yu sonunda temizler.
//
// Amaç: picker SADECE bu fason adımına FİİLEN sevk edilebilen topları göstermeli.
// Filtre, subcontractor.service dispatch() kabul kuralının BİREBİR aynısı:
//   (a) serbest stok      → currentStepId null  & STOCK            (auto-attach edilir)
//   (b) bu adımdaki top    → currentStepId === stepId & STOCK|IN_PRODUCTION
// Başka adımdaki üretim topu / AT_SUBCONTRACTOR / WAREHOUSE / FIRE / SCRAP
// listede GÖRÜNMEMELİ (eski bug: status IN (STOCK,IN_PRODUCTION) tüm fabrikadaki
// üretim toplarını dökerdi).
//
// Yöntem: her topa ayrı ayrı filter[id]=<roll> + filter[dispatchableForStepId]=<step>
// uygulanır → findAllRolls 1 satır döndürürse "uygun", 0 döndürürse "uygun değil".
// (DB'deki diğer serbest toplara karışmadan tek-tek deterministik kontrol.)

import { RollStatus, RollEntrySource, StationType } from "@prisma/client";
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";

const inventory = new InventoryService();

const createdRolls: string[] = [];
let woId: string | null = null;
let stepAId = ""; // hedef fason adımı
let stepBId = ""; // başka bir adım (KK1/KK2 gibi)

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const rand = () => Math.floor(Math.random() * 1e9);

async function makeRoll(opts: {
  status: RollStatus;
  currentStepId?: string | null;
  qualityGrade?: string;
}): Promise<string> {
  const item = await prisma.item.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok (npm run seed).");
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-FDP-${Date.now()}-${rand()}`,
      itemId: item.id,
      colorId: null,
      initialQty: 50,
      currentQty: 50,
      status: opts.status,
      currentStepId: opts.currentStepId ?? null,
      qualityGrade: opts.qualityGrade ?? "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  return roll.id;
}

/** Tek topu, picker filtresi altında çekmeyi dener. Dönerse uygun. */
async function isEligible(rollId: string, stepId: string): Promise<boolean> {
  const req = {
    query: {
      mode: "cursor",
      limit: "5",
      "filter[id]": rollId,
      "filter[dispatchableForStepId]": stepId,
    },
  } as unknown as Request;
  const res = (await inventory.findAllRolls(req)) as {
    data: Array<{ id: string }>;
  };
  return res.data.length === 1 && res.data[0].id === rollId;
}

/** Eski (buglı) filtre: status IN (STOCK,IN_PRODUCTION) — karşılaştırma için. */
async function isVisibleUnderOldFilter(rollId: string): Promise<boolean> {
  const req = {
    query: {
      mode: "cursor",
      limit: "5",
      "filter[id]": rollId,
      "filter[status]": "STOCK,IN_PRODUCTION",
    },
  } as unknown as Request;
  const res = (await inventory.findAllRolls(req)) as {
    data: Array<{ id: string }>;
  };
  return res.data.length === 1;
}

async function setup(): Promise<void> {
  let station = await prisma.station.findFirst({ select: { id: true } });
  if (!station) {
    station = await prisma.station.create({
      data: {
        code: `TEST-ST-${rand()}`,
        name: "Test İstasyon",
        type: StationType.EXTERNAL,
      },
      select: { id: true },
    });
  }
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-FDP-WO-${Date.now()}-${rand()}` },
    select: { id: true },
  });
  woId = wo.id;
  const stepA = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  const stepB = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 2 },
    select: { id: true },
  });
  stepAId = stepA.id;
  stepBId = stepB.id;
}

async function main(): Promise<void> {
  console.log("=== Fason Sevk Picker Filtre Testi (dispatchableForStepId) ===\n");
  await setup();

  // --- UYGUN olması gerekenler ---
  const freeStock = await makeRoll({ status: RollStatus.STOCK, currentStepId: null });
  check("(a) Serbest STOCK top uygun", await isEligible(freeStock, stepAId));

  const stockAtStep = await makeRoll({
    status: RollStatus.STOCK,
    currentStepId: stepAId,
  });
  check(
    "(b1) Bu adıma bağlı STOCK top uygun (geçiş durumu)",
    await isEligible(stockAtStep, stepAId)
  );

  const inProdAtStep = await makeRoll({
    status: RollStatus.IN_PRODUCTION,
    currentStepId: stepAId,
  });
  check(
    "(b2) Bu adımdaki IN_PRODUCTION top uygun",
    await isEligible(inProdAtStep, stepAId)
  );

  // --- UYGUN OLMAMASI gerekenler ---
  const inProdOtherStep = await makeRoll({
    status: RollStatus.IN_PRODUCTION,
    currentStepId: stepBId,
  });
  check(
    "Başka adımdaki IN_PRODUCTION top GÖRÜNMEZ (asıl bug)",
    !(await isEligible(inProdOtherStep, stepAId))
  );
  // Bu top eski filtrede görünüyordu — düzeltmenin etkisini kanıtla.
  check(
    "  ↳ Eski filtrede (status STOCK,IN_PRODUCTION) GÖRÜNÜRDÜ",
    await isVisibleUnderOldFilter(inProdOtherStep)
  );

  const stockOtherStep = await makeRoll({
    status: RollStatus.STOCK,
    currentStepId: stepBId,
  });
  check(
    "Başka adıma bağlı STOCK top GÖRÜNMEZ (serbest değil)",
    !(await isEligible(stockOtherStep, stepAId))
  );

  const atSub = await makeRoll({
    status: RollStatus.AT_SUBCONTRACTOR,
    currentStepId: stepAId,
  });
  check(
    "Zaten sevk edilmiş (AT_SUBCONTRACTOR) top GÖRÜNMEZ",
    !(await isEligible(atSub, stepAId))
  );

  const warehouse = await makeRoll({
    status: RollStatus.WAREHOUSE,
    currentStepId: null,
  });
  check("Depodaki (WAREHOUSE) top GÖRÜNMEZ", !(await isEligible(warehouse, stepAId)));

  const fire = await makeRoll({
    status: RollStatus.STOCK,
    currentStepId: null,
    qualityGrade: "FIRE",
  });
  check("FIRE kalite serbest stok GÖRÜNMEZ", !(await isEligible(fire, stepAId)));

  const scrap = await makeRoll({ status: RollStatus.SCRAP, currentStepId: null });
  check("SCRAP top GÖRÜNMEZ", !(await isEligible(scrap, stepAId)));

  const inProdFree = await makeRoll({
    status: RollStatus.IN_PRODUCTION,
    currentStepId: null,
  });
  check(
    "currentStep'siz IN_PRODUCTION top GÖRÜNMEZ (serbest stok değil)",
    !(await isEligible(inProdFree, stepAId))
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  if (createdRolls.length > 0) {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: createdRolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
  }
  if (stepAId || stepBId) {
    await prisma.workOrderStep.deleteMany({
      where: { id: { in: [stepAId, stepBId].filter(Boolean) } },
    });
  }
  if (woId) {
    await prisma.workOrder.deleteMany({ where: { id: woId } });
  }
  console.log(`Cleanup: ${createdRolls.length} roll + 2 step + 1 WO silindi.`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
