// Paylaşılan test fixture'ı — "Konumu Düzelt" (manualMove) testleri için dinamik WO.
// test_manual_move_backflush + test_manual_move_qc_reversal bunu kullanır. `test_`
// prefix'i YOK → run-all-tests koşucusu bunu bir test dosyası saymaz.
//
// Neden dinamik: eski testler hardcoded WO/parti UUID'lerine (IE1507260026 /
// P1507260092) bağlıydı ve reseed'de P2025 ile kırılıyordu (repo kuralı: hardcoded
// UUID yazma). Bu kurucu seed master-data'sını business-key ile çözer ve TEST-
// prefix'li geçici bir WO + 4-adım rota + parti + toplar yaratır; teardown söker.
//
// Rota (orijinal senaryoyla birebir): Zımpara → Boyahane(renk) → Kurşun+KK2 → Tambur.
//   seq1 ZIMPARA_FASON  — renk öncesi ilk adım
//   seq2 BOYA_FASON     — requiredCategoryId=appliesColor kategori (colorStep)
//   seq3 KURSUN_KK2     — PROCESS_QC (Kurşun+KK2)
//   seq4 TAMBUR_1       — Tambur
import prisma from "../src/lib/prisma";

export interface ManualMoveFixture {
  woId: string;
  batchId: string;
  targetColorId: string;
  /** stepSequence → workOrderStep.id (1..4). */
  stepIdBySeq: Record<number, string>;
  rollIds: string[];
  teardown: () => Promise<void>;
}

async function need<T extends { id: string }>(
  row: T | null,
  label: string,
): Promise<string> {
  if (!row) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
  return row.id;
}

/**
 * Dört-adımlı bir WO fixture'ı kurar. `rollCount` kadar renksiz top parti altında
 * doğar (henüz konumsuz — çağıran test kendi senaryosuna göre status/step kurar).
 * Toplar business-key ile çözülen ITEM'e bağlanır; barkod TEST- prefix'li benzersiz.
 */
export async function createManualMoveFixture(
  rollCount = 3,
): Promise<ManualMoveFixture> {
  const itemId = await need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Item",
  );
  const colorId = await need(
    await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Color",
  );
  const dyeCategoryId = await need(
    await prisma.subcontractorCategory.findFirst({
      where: { appliesColor: true },
      select: { id: true },
    }),
    "appliesColor kategori",
  );
  const stZimpara = await need(
    await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }),
    "Station ZIMPARA_FASON",
  );
  const stBoya = await need(
    await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }),
    "Station BOYA_FASON",
  );
  const stKursun = await need(
    await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }),
    "Station KURSUN_KK2",
  );
  const stTambur = await need(
    await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }),
    "Station TAMBUR_1",
  );

  const stamp = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TEST-MM-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: itemId,
      targetColorId: colorId,
      steps: {
        create: [
          { stationId: stZimpara, stepSequence: 1, status: "PENDING" },
          { stationId: stBoya, stepSequence: 2, status: "PENDING", requiredCategoryId: dyeCategoryId },
          { stationId: stKursun, stepSequence: 3, status: "PENDING" },
          { stationId: stTambur, stepSequence: 4, status: "PENDING" },
        ],
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  const stepIdBySeq: Record<number, string> = {};
  for (const s of wo.steps) stepIdBySeq[s.stepSequence] = s.id;

  const batch = await prisma.batch.create({
    data: { batchNumber: `TEST-P-${stamp}`, workOrderId: wo.id },
    select: { id: true },
  });

  const rollIds: string[] = [];
  for (let i = 0; i < rollCount; i++) {
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-MM-${stamp}-${i}`,
        itemId,
        batchId: batch.id,
        initialQty: 100,
        currentQty: 100,
        status: "IN_PRODUCTION",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    rollIds.push(r.id);
  }

  const teardown = async (): Promise<void> => {
    // Söküm sırası: çocuk toplar (parentRollId) → fixture toplar → parti → adım → WO.
    const children = await prisma.roll.findMany({
      where: { parentRollId: { in: rollIds } },
      select: { id: true },
    });
    const allRollIds = [...rollIds, ...children.map((c) => c.id)];
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: allRollIds } } });
    // Tambur kapanışı plan sapması yazabilir; satırı kalırsa top silinmez (FK).
    await prisma.rollPlanDeviation.deleteMany({
      where: { OR: [{ rollId: { in: allRollIds } }, { childRollId: { in: allRollIds } }] },
    });
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } });
    // ⚠️ PARTİ SİLME İŞ EMRİ KAPSAMLIDIR, "fixture'ın açtığı parti" DEĞİL.
    // Fixture tek parti açar ama bu WO'ya SONRADAN başka partiler doğabilir —
    // `batch.autoCreateEnabled` (D7) açıkken sunucu Tambur manuel girişinde
    // partiyi kendisi yaratır. Tek-id'li silme onları bırakır ve
    // `batches_workOrderId_fkey` WO silmesini P2003 ile düşürür: bekçi kırmızı
    // verir ama sebebi ölçtüğü kuralla İLGİSİZDİR (2026-09-03'te ölçüldü).
    const woBatches = await prisma.batch.findMany({
      where: { workOrderId: wo.id },
      select: { id: true },
    });
    const batchIds = woBatches.map((b) => b.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: batchIds } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: wo.id } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.workOrder.delete({ where: { id: wo.id } });
  };

  return { woId: wo.id, batchId: batch.id, targetColorId: colorId, stepIdBySeq, rollIds, teardown };
}
