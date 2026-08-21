// TEST: ÜRETİLEN METRAJ KOVALARI — kalite kodu KATALOGDAN çözülür, A1 SAYILIR.
//
// ── D1 bulgusu (2026-08-21) ─────────────────────────────────────────────────
// İki yerde kalite kodu GÖMÜLÜYDÜ ve ikisi AYRIŞMIŞTI:
//   • liste  `withProductionMeters` → `qualityGrade notIn ["FIRE","A1"]`
//   • detay  `producedRolls`        → `=== "FIRE"` / `=== "A1"` kovaları,
//                                      `totalMeters = warehouse + a1`
// Yani AYNI iş emri liste ekranında A1'siz, detay ekranında A1'li bir "çıkan"
// metraj gösteriyordu. Ayrıca `schema.prisma` QualityGrade notu kod gömmeyi
// açıkça yasaklar: katalog kodu fabrikaya AÇIK bir alandır, "2. Fire" gibi yeni
// bir SCRAP kademesi gömülü listeye girmez ve sessizce SAĞLAM ÜRETİM sayılırdı.
//
// Yeni kural (kullanıcı kararı): kova `QualityGrade.targetStatus`'tan çözülür —
//   SCRAP → fire (üretim SAYILMAZ) · A1_STOCK → a1 (SATILABİLİR, SAYILIR) ·
//   diğer/null → warehouse. Liste artık detayla birebir aynı sayıyı basar.
//
//   B1  bucketOf: SCRAP hedefli TEST kalite → "fire"
//   B2  bucketOf: A1_STOCK hedefli TEST kalite → "a1"
//   B3  bucketOf: null/boş kod → "warehouse"
//   B4  bucketOf: katalogda OLMAYAN kod → "warehouse" + unknownCodes'a düşer
//   B5  PASİF katalog satırı da çözülür (isActive süzgeci YOK — pasife alınmış
//       eski kod hâlâ geçmiş topların üstündedir)
//   B6  fireCodes/a1Codes kümeleri doğru
//   B7  UÇTAN UCA: liste `producedMeters` == detay `producedRolls.totalMeters`
//       (A1'li iş emrinde) ve fire metrajı İKİSİNDE DE dışarıda
//
// Çalıştır: npx tsx scripts/test_produced_buckets.ts
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { loadProducedBuckets } from "../src/services/helpers/roll-finalize.helper";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollStatus, RollEntrySource } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const wos = new WorkOrderService();

/** TEST- önekli katalog kodları — cleanup'ta silinir. */
const CODE_W = "TEST-KOVA-DEPO";
const CODE_A1 = "TEST-KOVA-A1";
const CODE_FIRE = "TEST-KOVA-FIRE";
const CODE_PASIF_FIRE = "TEST-KOVA-PASIF-FIRE";
const CODE_HAYALET = "TEST-KOVA-KATALOGDA-YOK";

const createdGradeCodes = [CODE_W, CODE_A1, CODE_FIRE, CODE_PASIF_FIRE];
const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .toUpperCase()
    .padStart(6, "0");
  return `TST-PB-${rand}${bc}`;
}

function woNumber(): string {
  const gun = `${Date.now()}`.slice(-6);
  const seq = String(1000 + Math.floor(Math.random() * 9000));
  return `IE${gun}${seq}`;
}

async function ensureGrade(code: string, targetStatus: RollStatus, isActive = true): Promise<void> {
  await prisma.qualityGrade.upsert({
    where: { code },
    create: { code, name: `TEST ${code}`, targetStatus, isActive, sortOrder: 900 },
    update: { targetStatus, isActive },
  });
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const station = await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } });
  if (!item || !admin || !station) throw new Error("Seed fixture eksik — önce 'npm run seed'");

  await ensureGrade(CODE_W, RollStatus.WAREHOUSE);
  await ensureGrade(CODE_A1, RollStatus.A1_STOCK);
  await ensureGrade(CODE_FIRE, RollStatus.SCRAP);
  await ensureGrade(CODE_PASIF_FIRE, RollStatus.SCRAP, false);

  // ═══ B1–B6: katalog çözümü ═══
  console.log("\n=== B1-B6: kova KATALOGDAN çözülüyor ===");
  const buckets = await loadProducedBuckets(prisma);
  check("B1: SCRAP hedefli kalite → fire", buckets.bucketOf(CODE_FIRE) === "fire");
  check("B2: A1_STOCK hedefli kalite → a1", buckets.bucketOf(CODE_A1) === "a1");
  check("B3a: WAREHOUSE hedefli kalite → warehouse", buckets.bucketOf(CODE_W) === "warehouse");
  check("B3b: null kod → warehouse", buckets.bucketOf(null) === "warehouse");
  check("B3c: boş kod → warehouse", buckets.bucketOf("") === "warehouse");
  check(
    "B4a: katalogda OLMAYAN kod → warehouse (üretim durmaz)",
    buckets.bucketOf(CODE_HAYALET) === "warehouse",
  );
  check("B4b: bilinmeyen kod unknownCodes'a düştü", buckets.unknownCodes.has(CODE_HAYALET));
  check(
    "B4c: null/boş kod unknownCodes'a DÜŞMEZ (kaliteye bakılmadı ≠ bilinmeyen kod)",
    !buckets.unknownCodes.has("") && buckets.unknownCodes.size === 1,
    `unknown ${[...buckets.unknownCodes].join(",")}`,
  );
  check(
    "B5: PASİF katalog satırı da çözülür (isActive süzgeci YOK)",
    buckets.bucketOf(CODE_PASIF_FIRE) === "fire",
  );
  check("B6a: fireCodes TEST kodlarını içeriyor", buckets.fireCodes.includes(CODE_FIRE) && buckets.fireCodes.includes(CODE_PASIF_FIRE));
  check("B6b: a1Codes TEST kodunu içeriyor", buckets.a1Codes.includes(CODE_A1));
  check(
    "B6c: fireCodes ile a1Codes ayrık",
    buckets.fireCodes.every((c) => !buckets.a1Codes.includes(c)),
  );

  // ═══ B7: uçtan uca — liste ↔ detay hizası ═══
  console.log("\n=== B7: liste producedMeters == detay totalMeters (A1 SAYILIR) ===");
  const num = woNumber();
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: num,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: item.id,
      steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" }] },
    },
    include: { steps: true },
  });
  createdWoIds.push(wo.id);
  const stepId = wo.steps[0]!.id;

  // Üretim çıktısı kümesi (producedOutputWhere dal b): TAMBUR_SPLIT OLMAYAN +
  // nihai statüdeki toplar. Üçü de bu WO'nun adımında üretildi.
  const specs: Array<{ qty: number; grade: string | null; status: RollStatus }> = [
    { qty: 100, grade: CODE_W, status: RollStatus.WAREHOUSE },
    { qty: 50, grade: CODE_A1, status: RollStatus.A1_STOCK },
    { qty: 30, grade: CODE_FIRE, status: RollStatus.SCRAP },
    { qty: 20, grade: null, status: RollStatus.WAREHOUSE },
  ];
  for (const sp of specs) {
    const r = await prisma.roll.create({
      data: {
        barcode: barcode(),
        itemId: item.id,
        initialQty: sp.qty,
        currentQty: sp.qty,
        status: sp.status,
        width: 250,
        createdById: admin.id,
        producedInStepId: stepId,
        entrySource: RollEntrySource.MANUAL_ENTRY,
        qualityGrade: sp.grade,
      },
      select: { id: true },
    });
    createdRollIds.push(r.id);
  }

  const detail = await wos.findById(wo.id);
  const produced = (detail.data as {
    producedRolls: {
      totalMeters: unknown;
      warehouse: { totalMeters: unknown; count: number };
      a1: { totalMeters: unknown; count: number };
      fire: { totalMeters: unknown; count: number };
    };
  }).producedRolls;
  const detWarehouse = Number(produced.warehouse.totalMeters);
  const detA1 = Number(produced.a1.totalMeters);
  const detFire = Number(produced.fire.totalMeters);
  const detTotal = Number(produced.totalMeters);

  check("B7a: detay warehouse 120 (100 + kalitesiz 20)", detWarehouse === 120, `${detWarehouse}`);
  check("B7b: detay a1 50", detA1 === 50, `${detA1}`);
  check("B7c: detay fire 30", detFire === 30, `${detFire}`);
  check("B7d: detay totalMeters 170 (warehouse + a1, fire HARİÇ)", detTotal === 170, `${detTotal}`);

  const listRes = await wos.findAll({
    query: { search: num, limit: "20" },
  } as unknown as Request);
  const row = ((listRes as { data: Array<{ workOrderNumber?: string; producedMeters?: number }> }).data ?? []).find(
    (r) => r.workOrderNumber === num,
  );
  check("B7e: WO listede bulundu", !!row);
  check(
    "B7f: liste producedMeters == detay totalMeters (A1 artık İKİSİNDE DE sayılıyor)",
    Math.abs((row?.producedMeters ?? -1) - detTotal) < 0.001,
    `liste ${row?.producedMeters} ↔ detay ${detTotal}`,
  );
  check(
    "B7g: fire metrajı listede DE dışarıda (170 ≠ 200)",
    (row?.producedMeters ?? 0) === 170,
    `${row?.producedMeters}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (createdRollIds.length > 0) {
      // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ.
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: createdRollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: createdRollIds } } });
    }
    if (createdWoIds.length > 0) {
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: createdWoIds } } } });
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
      await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
      await prisma.systemLog.deleteMany({
        where: { recordId: { in: [...createdRollIds, ...createdWoIds] } },
      });
      await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    }
    // Katalog satırları: hiçbir canlı top üzerinde kalmadıysa güvenle silinir.
    for (const code of createdGradeCodes) {
      const used = await prisma.roll.count({ where: { qualityGrade: code } });
      if (used === 0) await prisma.qualityGrade.deleteMany({ where: { code } });
    }
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
