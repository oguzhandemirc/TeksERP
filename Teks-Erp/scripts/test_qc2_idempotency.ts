// Tek-seferlik idempotency doğrulama testi (Kurşun completeQc2 @@unique).
// Çalıştırma:  npx ts-node scripts/test_qc2_idempotency.ts
// Bittikten sonra script silinebilir.

import { RollOperationType } from "@prisma/client";
import prisma from "../src/lib/prisma";

// F266: scripts/test_*.ts sözleşmesi — check() sayaçları + '=== Sonuç ===' satırı.
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

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

  check("İdempotency: 5 upsert → tek satır (@@unique + update:{})", count === 1, `satır=${count}`);

  // Şimdi P2002 direct-create testi:
  let p2002 = false;
  try {
    await prisma.rollOperation.create({
      data: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        metadata: { p2002Test: true },
      },
    });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "P2002") {
      p2002 = true;
    } else {
      console.error("Beklenmedik hata:", e);
    }
  }
  check("Direct create P2002 fırlattı (unique constraint aktif)", p2002);

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

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
