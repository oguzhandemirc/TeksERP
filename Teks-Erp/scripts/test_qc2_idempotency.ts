// Tek-seferlik idempotency doğrulama testi (Kurşun completeQc2 @@unique).
// Çalıştırma:  npx ts-node scripts/test_qc2_idempotency.ts
// Bittikten sonra script silinebilir.

import { RollOperationType } from "@prisma/client";
import prisma from "../src/lib/prisma";

async function main() {
  // PROCESS_QC adımında veya geçmişte bulunmuş bir roll bul.
  const op = await prisma.rollOperation.findFirst({
    where: { operationType: RollOperationType.QC2_COMPLETED },
    select: { rollId: true, workOrderStepId: true, id: true },
  });

  let rollId: string;
  let stepId: string;
  let preexisting: boolean;

  if (op) {
    rollId = op.rollId;
    stepId = op.workOrderStepId;
    preexisting = true;
    console.log(
      `Existing QC2_COMPLETED bulundu — rollId=${rollId}, stepId=${stepId}`,
    );
  } else {
    // Hiç QC2_COMPLETED yoksa, herhangi bir roll + step bul (rastgele).
    const step = await prisma.workOrderStep.findFirst({
      where: { station: { kind: "PROCESS_QC" } },
      select: { id: true },
    });
    const roll = await prisma.roll.findFirst({
      where: { status: { notIn: ["CANCELLED", "SCRAP"] } },
      select: { id: true },
    });
    if (!step || !roll) {
      console.log("Test verisi yetersiz — PROCESS_QC step veya roll yok.");
      return;
    }
    rollId = roll.id;
    stepId = step.id;
    preexisting = false;
    console.log(
      `Fresh test case — rollId=${rollId}, stepId=${stepId} (QC2 yok)`,
    );
  }

  const ops = 5;
  const startedAt = Date.now();
  for (let i = 0; i < ops; i++) {
    await prisma.rollOperation.upsert({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId,
          workOrderStepId: stepId,
          operationType: RollOperationType.QC2_COMPLETED,
        },
      },
      create: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        metadata: { idempotencyTest: true, attempt: i + 1 },
      },
      update: {},
    });
  }
  const tookMs = Date.now() - startedAt;

  const count = await prisma.rollOperation.count({
    where: {
      rollId,
      workOrderStepId: stepId,
      operationType: RollOperationType.QC2_COMPLETED,
    },
  });

  console.log(`Upsert sayısı: ${ops} (${tookMs}ms)`);
  console.log(`DB'deki satır sayısı: ${count} (beklenen: 1)`);
  console.log(`Önceden vardı: ${preexisting}`);

  if (count !== 1) {
    console.error("❌ İDEMPOTENCY KIRIK — birden fazla satır oluştu!");
    process.exitCode = 1;
  } else {
    console.log("✅ Idempotency çalışıyor (@@unique + upsert update:{} doğru).");
  }

  // Şimdi P2002 direct-create testi:
  try {
    await prisma.rollOperation.create({
      data: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        metadata: { p2002Test: true },
      },
    });
    console.error(
      "❌ P2002 FIRLATILMADI — unique constraint çalışmıyor olmalı?",
    );
    process.exitCode = 1;
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "P2002") {
      console.log("✅ Direct create P2002 fırlattı (unique constraint aktif).");
    } else {
      console.error("❌ Beklenmedik hata:", e);
      process.exitCode = 1;
    }
  }

  // Eğer fresh case açtıysak temizle.
  if (!preexisting) {
    await prisma.rollOperation.deleteMany({
      where: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
      },
    });
    console.log("Cleanup: fresh test case temizlendi.");
  } else {
    console.log("Cleanup: önceden var olan satıra dokunulmadı.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
