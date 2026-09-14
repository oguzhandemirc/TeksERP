// Tambur'a kadar gelmiş gerçek bir top kurar — mobil Tambur ekranından elle test için.
//
// Çalıştırma:
//   npx ts-node scripts/seed-tambur-test-roll.ts          → yeni senaryo oluştur
//   npx ts-node scripts/seed-tambur-test-roll.ts --clean  → bu script'in ürettiği test verisini sil
//
// Ne kurar (gerçek üretim akışıyla AYNI şekil):
//   • WorkOrder (IN_PROGRESS) — gerçek İE formatında numara, parameters.seedScript işaretli
//   • WorkOrderStep — Tambur istasyonunda, status=ACTIVE
//   • Roll — renkli AÇIK KUMAŞ (barcode=null), IN_PRODUCTION, currentStepId=Tambur step, 100 mt
//   • RollMovement — Tambur step'inde açık (exitedAt=null) → ekranda görünür
//   • TravelerCard (refakat kartı) — ACTIVE, gerçek print() ile (kart no + barkod)
//
// Mobil Tambur ekranında: kartı okut (veya "Açık İşler"den seç) → 100 mt'lik açık kumaşı
// gör → "Kes" ile 150 yaz → over-quantity onay diyaloğu → 150 mt'lik top oluşur.

import {
  RollStatus,
  RollEntrySource,
  StationKind,
  StationType,
  StepStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../src/utils/code-format";

// Bu script'in ürettiği veriyi `--clean` için bulunabilir kılan işaret.
//
// NEDEN `workOrderNumber` ÖN EKİ DEĞİL (eski hâli "TAMBUR-TEST-…" idi):
// refakat kartında tek-kod kuralı geçerli → `cardNumber = barcode = workOrderNumber`,
// ve okutma yolu `TravelerCardService.scan()` girişte `isCardCode()` ile
// İE+GGAAYY+NNNN formatını DAYATIR. Serbest metinli bir numara kartı sessizce
// okutulamaz hâle getirirdi — oysa script'in birincil kullanımı tam olarak
// "Kart Barkod (okut)". Bu yüzden numara gerçek İE formatında üretilir, "test
// verisi" işareti ise WorkOrder'ın serbest-meta alanı `parameters`'a yazılır.
const SEED_MARKER = "seed-tambur-test-roll";
const ROLL_QTY = 100; // açık kumaşın metresi — testte 150 yazıp aşımı dene

/**
 * Bugünün sırasındaki ilk boş İE numarası. Gerçek servis `withBarcodeRetry` +
 * tx-içi sequence ile üretir; burada tek kullanıcılı dev script olduğu için
 * max+1 yeterli (yarış yok).
 */
async function nextWorkOrderNumber(): Promise<string> {
  const full = dailyCodePrefix("IE");
  const todays = await prisma.workOrder.findMany({
    where: { workOrderNumber: { gte: full, startsWith: full } },
    select: { workOrderNumber: true },
  });
  return buildDailyCode("IE", nextDailySeq(todays.map((w) => w.workOrderNumber), full));
}

const travelerCards = new TravelerCardService();

async function getTamburStation() {
  let station = await prisma.station.findFirst({
    where: { kind: StationKind.TAMBUR, isActive: true },
    select: { id: true, name: true },
  });
  if (!station) {
    station = await prisma.station.create({
      data: {
        code: `TAMBUR_TEST_${Date.now()}`,
        name: "Tambur (test)",
        type: StationType.INTERNAL,
        kind: StationKind.TAMBUR,
        department: "KALITE",
      },
      select: { id: true, name: true },
    });
    console.log(`ℹ️  TAMBUR istasyonu yoktu, oluşturuldu: ${station.name}`);
  }
  return station;
}

async function seed() {
  const item = await prisma.item.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  if (!item) throw new Error("Aktif Item yok — önce `npm run seed` çalıştır.");

  // Renkli açık kumaş (boyahane dönüşü) gerçekçi; renk yoksa ham bırak.
  const color = await prisma.color.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const admin = await prisma.user.findFirst({
    where: { username: "admin" },
    select: { id: true },
  });

  const station = await getTamburStation();

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: await nextWorkOrderNumber(),
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      foldType: "2-KAT",
      targetItemId: item.id,
      targetColorId: color?.id ?? null,
      parameters: { seedScript: SEED_MARKER },
    },
    select: { id: true, workOrderNumber: true },
  });

  const step = await prisma.workOrderStep.create({
    data: {
      workOrderId: wo.id,
      stationId: station.id,
      stepSequence: 1,
      status: StepStatus.ACTIVE,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  const roll = await prisma.roll.create({
    data: {
      barcode: null, // AÇIK KUMAŞ — over-quantity "açık kumaş→top" senaryosu
      itemId: item.id,
      colorId: color?.id ?? null,
      width: 150,
      initialQty: ROLL_QTY,
      currentQty: ROLL_QTY,
      status: RollStatus.IN_PRODUCTION,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
      currentStepId: step.id,
      producedInStepId: step.id,
    },
    select: { id: true },
  });

  // Tambur step'inde AÇIK hareket — loadTamburRolls bunu (exitedAt=null) okur.
  await prisma.rollMovement.create({
    data: {
      rollId: roll.id,
      workOrderStepId: step.id,
      qtyIn: ROLL_QTY,
      enteredAt: new Date(),
      exitedAt: null,
      operatorId: admin?.id ?? null,
    },
  });

  // Gerçek refakat kartı (ACTIVE) — kart no + barkod üretir, snapshot dondurur.
  const cardRes = await travelerCards.print(wo.id, admin?.id);
  const card = cardRes.data;

  console.log("\n✅ Tambur'a kadar gelmiş test topu hazır.\n");
  console.log("  İş Emri No        :", wo.workOrderNumber);
  console.log("  Ürün              :", item.name);
  console.log("  Renk              :", color?.name ?? "(ham/renksiz)");
  console.log("  Açık kumaş metresi:", `${ROLL_QTY} mt`);
  console.log("  İstasyon          :", station.name, "(TAMBUR)\n");
  console.log("  ── Mobil Tambur ekranında ──");
  console.log("  Kart No (elle yaz):", card.cardNumber);
  console.log("  Kart Barkod (okut):", card.barcode);
  console.log("  veya 'Açık İşler' listesinden seç.\n");
  console.log(
    `  Test: "Kes" → 150 yaz → over-quantity onayı → 150 mt top (100 mt açık kumaştan).\n`,
  );
  console.log(`  Temizlik: npx ts-node scripts/seed-tambur-test-roll.ts --clean\n`);
}

async function cleanup() {
  // İşaret `parameters` JSON'unda; index YOK → seq scan. Dev-only temizlik
  // script'i olduğu için kabul edilebilir (CLAUDE.md'nin GIN-index kuralı
  // sorgulanan ENDPOINT'ler içindir, elle koşulan bakım script'i için değil).
  const wos = await prisma.workOrder.findMany({
    where: { parameters: { path: ["seedScript"], equals: SEED_MARKER } },
    select: { id: true, workOrderNumber: true },
  });
  if (wos.length === 0) {
    console.log("Temizlenecek test verisi yok.");
    return;
  }
  const woIds = wos.map((w) => w.id);
  const steps = await prisma.workOrderStep.findMany({
    where: { workOrderId: { in: woIds } },
    select: { id: true },
  });
  const stepIds = steps.map((s) => s.id);

  // Bu adımlarda üretilmiş/duran toplar + (operatör kestiyse) onların çocukları.
  const rolls = await prisma.roll.findMany({
    where: {
      OR: [
        { currentStepId: { in: stepIds } },
        { producedInStepId: { in: stepIds } },
      ],
    },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  const children = await prisma.roll.findMany({
    where: { parentRollId: { in: rollIds } },
    select: { id: true },
  });
  const allRollIds = [...new Set([...rollIds, ...children.map((c) => c.id)])];

  const cards = await prisma.travelerCard.findMany({
    where: { workOrderId: { in: woIds } },
    select: { id: true },
  });
  const cardIds = cards.map((c) => c.id);

  // Bağımlılık sırasıyla sil (FK güvenli).
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } }).catch(() => {});
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } }).catch(() => {});
  if (allRollIds.length) {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: allRollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: allRollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } }).catch(() => {});
    await prisma.rollError.deleteMany({ where: { rollId: { in: allRollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRollIds } } }).catch(() => {});
  }
  if (stepIds.length) {
    await prisma.rollMovement.deleteMany({ where: { workOrderStepId: { in: stepIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: { in: stepIds } } }).catch(() => {});
  }
  if (allRollIds.length) {
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds }, parentRollId: { not: null } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } }).catch(() => {});
  }
  await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } }).catch(() => {});
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});

  console.log(`Temizlendi: ${wos.length} test iş emri (${wos.map((w) => w.workOrderNumber).join(", ")}).`);
}

const isClean = process.argv.includes("--clean");

(isClean ? cleanup() : seed())
  .catch((e) => {
    console.error("Hata:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
