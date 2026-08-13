// Tambur "over-quantity" (çıkan top metresi giriş metresini aşabilir) davranış testi.
// Çalıştırma:  npx ts-node scripts/test_tambur_over_quantity.ts
// Test verisi üzerinde çalışır; ürettiği roll/step/WO/station kayıtlarını sonunda temizler.
// Flag'i (tambur.overQuantityEnabled) geçici değiştirir; sonunda ESKİ değerine geri alır.
//
// Doğrulananlar:
//   FLAG KAPALI → her üç yolda da aşan giriş REDDEDİLİR (bugünkü davranış korunur):
//     1. cutWarehouseRoll  (depo topu yeniden kesim)
//     2. cutOpenFabric     (açık kumaş → top)
//     3. finalize          (çoklu kesim)
//   FLAG AÇIK → aşan giriş KABUL edilir, kaynak top TAMAMEN tüketilir (negatif kalan yok):
//     4. cutWarehouseRoll(100m, kes 150) → çocuk 150m, parent currentQty=0 & initialQty=0
//     5. cutOpenFabric(100m, 150)        → çocuk 150m, parent currentQty=0
//     6. finalize(100m, cuts toplam 150) → çocuklar toplam 150m, parent TAMBUR_CONSUMED
//   FLAG AÇIK + aşımsız → normal düşüm bozulmaz:
//     7. cutWarehouseRoll(100m, kes 40)  → parent kalan 60 (decrement çalışır)

import {
  RollStatus,
  RollEntrySource,
  StationKind,
  StationType,
  StepStatus,
} from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";

const tambur = new TamburService();
const FLAG_KEY = "tambur.overQuantityEnabled";

const createdRolls: string[] = [];
const createdSteps: string[] = [];
const createdWOs: string[] = [];
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

async function expectReject(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "beklenen hata atılmadı (kabul edildi)");
  } catch {
    check(label, true, "reddedildi");
  }
}

async function setFlag(v: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: FLAG_KEY },
    update: { value: v },
    create: { key: FLAG_KEY, value: v, description: "test geçici" },
  });
}

async function firstActiveItemId(): Promise<string> {
  const item = await prisma.item.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok (önce npm run seed).");
  return item.id;
}

function rnd() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Barkodlu WAREHOUSE depo topu — cutWarehouseRoll için. */
async function makeWarehouseRoll(itemId: string, qty: number) {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-OQ-WH-${rnd()}`,
      itemId,
      colorId: null,
      width: 150,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.TAMBUR_SPLIT,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  return roll.id;
}

/** Açık kumaş (barkodsuz) — Tambur step'inde IN_PRODUCTION. cutOpenFabric için. */
async function makeOpenFabricRollOnTamburStep(itemId: string, qty: number) {
  // TAMBUR istasyonu bul / oluştur.
  let station = await prisma.station.findFirst({
    where: { kind: StationKind.TAMBUR },
    select: { id: true },
  });
  if (!station) {
    const s = await prisma.station.create({
      data: {
        code: `TEST-TAMBUR-${rnd()}`,
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
    data: { workOrderNumber: `TEST-OQ-WO-${rnd()}`, status: "IN_PROGRESS" },
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
  const roll = await prisma.roll.create({
    data: {
      barcode: null, // açık kumaş
      itemId,
      colorId: null,
      width: 150,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.IN_PRODUCTION,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
      currentStepId: step.id,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  return roll.id;
}

/** finalize için roll: barkodsuz, Tambur step'inde IN_PRODUCTION.
 *  (Eskiden step'sizdi; finalize artık kardeş yollar gibi "Tambur adımında +
 *  IN_PRODUCTION" guard'ı taşıdığından gerçek akışla aynı fixture kullanılır.) */
async function makeFinalizeRoll(itemId: string, qty: number) {
  return makeOpenFabricRollOnTamburStep(itemId, qty);
}

async function trackChildren(parentId: string) {
  const kids = await prisma.roll.findMany({
    where: { parentRollId: parentId },
    select: { id: true },
  });
  for (const k of kids) if (!createdRolls.includes(k.id)) createdRolls.push(k.id);
  return kids.map((k) => k.id);
}

async function main() {
  console.log("=== Tambur Over-Quantity Testi ===\n");
  const itemId = await firstActiveItemId();

  // ───────── FLAG KAPALI: aşan giriş reddedilmeli ─────────
  await setFlag(false);
  console.log("— Flag KAPALI —");

  const whReject = await makeWarehouseRoll(itemId, 100);
  await expectReject("cutWarehouseRoll aşımı reddetti (flag kapalı)", () =>
    tambur.cutWarehouseRoll(whReject, { cutLength: 150 }),
  );

  const ofReject = await makeOpenFabricRollOnTamburStep(itemId, 100);
  await expectReject("cutOpenFabric aşımı reddetti (flag kapalı)", () =>
    tambur.cutOpenFabric(ofReject, { lengthMeters: 150, status: "WAREHOUSE" }),
  );

  const finReject = await makeFinalizeRoll(itemId, 100);
  await expectReject("finalize aşımı reddetti (flag kapalı)", () =>
    tambur.finalize({
      rollId: finReject,
      decisions: [],
      cuts: [{ length: 150, qualityGrade: "1.KALITE", relatedErrorIds: [] }],
    }),
  );

  // ───────── FLAG AÇIK: aşan giriş kabul, kaynak tamamen tüketilir ─────────
  await setFlag(true);
  console.log("\n— Flag AÇIK —");

  // 4. cutWarehouseRoll(100, kes 150)
  const wh = await makeWarehouseRoll(itemId, 100);
  const whRes = await tambur.cutWarehouseRoll(wh, { cutLength: 150 });
  createdRolls.push(whRes.data.childRoll.id);
  check(
    "cutWarehouseRoll çocuk 150m oldu",
    Number(whRes.data.childRoll.currentQty) === 150,
    `çocuk=${whRes.data.childRoll.currentQty}`,
  );
  const whParent = await prisma.roll.findUnique({
    where: { id: wh },
    select: { currentQty: true, initialQty: true },
  });
  check(
    "cutWarehouseRoll parent tamamen tükendi (currentQty=0, initialQty=0)",
    Number(whParent?.currentQty) === 0 && Number(whParent?.initialQty) === 0,
    `current=${whParent?.currentQty} initial=${whParent?.initialQty}`,
  );

  // 5. cutOpenFabric(100, 150)
  const of = await makeOpenFabricRollOnTamburStep(itemId, 100);
  const ofRes = await tambur.cutOpenFabric(of, { lengthMeters: 150, status: "WAREHOUSE" });
  createdRolls.push(ofRes.data.childRoll.id);
  check(
    "cutOpenFabric çocuk 150m oldu",
    Number(ofRes.data.childRoll.currentQty) === 150,
    `çocuk=${ofRes.data.childRoll.currentQty}`,
  );
  check(
    "cutOpenFabric parent kalan 0 (tamamen tükendi)",
    ofRes.data.parentRemainingQty === 0,
    `kalan=${ofRes.data.parentRemainingQty}`,
  );

  // 5b. 0'A İNMİŞ TOPTA EK KESİMLER (2026-08-12 saha vakası): 500 m kayıtlı kumaş
  // fiziksel 550 m çıkar; fazlalık TEK topta bitmeyebilir (50 m → 3 top). Eski
  // aşım dalı `currentQty: { gt: 0 }` şartı taşıdığı için İKİNCİ kesim P2025'e
  // düşüp "bu sırada değişti" YARIŞ mesajı basıyordu — oysa yarış yoktu.
  const zc1 = await tambur.cutOpenFabric(of, { lengthMeters: 20, status: "WAREHOUSE" });
  createdRolls.push(zc1.data.childRoll.id);
  check(
    "0 kalanlı topta 2. kesim KABUL (çocuk 20m)",
    Number(zc1.data.childRoll.currentQty) === 20 && zc1.data.parentRemainingQty === 0,
    `çocuk=${zc1.data.childRoll.currentQty} kalan=${zc1.data.parentRemainingQty}`,
  );
  const zc2 = await tambur.cutOpenFabric(of, { lengthMeters: 15, status: "WAREHOUSE" });
  createdRolls.push(zc2.data.childRoll.id);
  check(
    "0 kalanlı topta 3. kesim de KABUL (çocuk 15m)",
    Number(zc2.data.childRoll.currentQty) === 15,
    `çocuk=${zc2.data.childRoll.currentQty}`,
  );
  // Her sıfır-üstü kesim SAPMA DEFTERİNE artı satır yazar — iz kaybolmaz.
  const zeroVariances = await prisma.rollVariance.count({ where: { rollId: of } });
  check(
    "sıfır-üstü kesimlerin HER BİRİ sapma defterinde",
    zeroVariances >= 3,
    `satır=${zeroVariances}`,
  );

  // 6. finalize(100, cuts toplam 150)
  const fin = await makeFinalizeRoll(itemId, 100);
  const finRes = await tambur.finalize({
    rollId: fin,
    decisions: [],
    cuts: [
      { length: 120, qualityGrade: "1.KALITE", relatedErrorIds: [] },
      { length: 30, qualityGrade: "1.KALITE", relatedErrorIds: [] },
    ],
  });
  await trackChildren(fin);
  const childSum = finRes.data.splitRolls.reduce(
    (s, r) => s + Number(r.currentQty),
    0,
  );
  check("finalize çocuk toplamı 150m", childSum === 150, `toplam=${childSum}`);
  const finParent = await prisma.roll.findUnique({
    where: { id: fin },
    select: { status: true, currentQty: true },
  });
  check(
    "finalize parent TAMBUR_CONSUMED + currentQty 0",
    finParent?.status === RollStatus.TAMBUR_CONSUMED && Number(finParent?.currentQty) === 0,
    `status=${finParent?.status} qty=${finParent?.currentQty}`,
  );

  // 7. Flag açık + aşımsız → normal düşüm korunur
  const whNormal = await makeWarehouseRoll(itemId, 100);
  const whNormalRes = await tambur.cutWarehouseRoll(whNormal, { cutLength: 40 });
  createdRolls.push(whNormalRes.data.childRoll.id);
  check(
    "Flag açıkken aşımsız kesim normal düştü (100→60)",
    whNormalRes.data.parentRemainingQty === 60,
    `kalan=${whNormalRes.data.parentRemainingQty}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup() {
  // Testte yarattığımız geçici flag satırını tamamen kaldır → reader default'a
  // (kayıt yok = TRUE/açık) döner, ortam başlangıç durumuna gelir.
  await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } }).catch(() => {});

  if (createdRolls.length) {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: createdRolls } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
    // Önce çocuklar (parentRollId set), sonra parent'lar.
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls }, parentRollId: { not: null } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
  }
  if (createdSteps.length) {
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: { in: createdSteps } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { id: { in: createdSteps } } }).catch(() => {});
  }
  if (createdWOs.length) {
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWOs } } }).catch(() => {});
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
