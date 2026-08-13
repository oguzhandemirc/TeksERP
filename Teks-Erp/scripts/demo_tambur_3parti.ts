// =============================================================================
// DEMO: 3 partili (her partide 2 açık kumaş) Tambur'a gelmiş iş emri
// =============================================================================
// Kullanıcı isteği (2026-08-12): parti dirilme / geri alma denemeleri için
// TEMİZ bir sahne. Gerçek servis/kurallarla doğar:
//   • İE numarası gerçek sayaçtan, refakat kartı TravelerCardService'ten
//   • Parti numaraları `generateBatchNumberTx`ten (kısa dönen P.. formatı)
//   • 6 açık kumaş (barkodsuz, form ACIK) Tambur adımında IN_PRODUCTION
// TEMİZLİK YOK — deneme sahnesi kalıcı. Çalıştır: npx tsx scripts/demo_tambur_3parti.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { generateBatchNumberTx } from "../src/services/batch.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { StationKind, RollStatus, StepStatus } from "@prisma/client";

const QTYS: [number, number][] = [
  [100, 80],
  [120, 60],
  [90, 110],
];

async function main(): Promise<void> {
  const item = await prisma.item.findFirstOrThrow({
    where: { isActive: true, itemType: "FABRIC", code: "PATOS" },
    select: { id: true, name: true },
  }).catch(() => prisma.item.findFirstOrThrow({ where: { isActive: true, itemType: "FABRIC" }, select: { id: true, name: true } }));
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" }, select: { id: true } });
  const tambur = await prisma.station.findFirstOrThrow({
    where: { kind: StationKind.TAMBUR, isActive: true },
    select: { id: true, name: true },
  });

  const stamp = `${new Date().getDate()}`.padStart(2, "0") + `${new Date().getHours()}${new Date().getMinutes()}`;
  const woNumber = `İE-DENEME-${stamp}`;

  const result = await prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.create({
      data: {
        workOrderNumber: woNumber,
        type: "STOCK_PRODUCTION",
        status: "IN_PROGRESS",
        width: 150,
        targetItemId: item.id,
        steps: { create: [{ stationId: tambur.id, stepSequence: 1, status: StepStatus.ACTIVE }] },
      },
      include: { steps: true },
    });
    const step = wo.steps[0];

    // Refakat kartı — tablet "Liste"si karttan okur; kartsız iş emri açılamaz.
    const cardSvc = new TravelerCardService();
    await cardSvc.createForWorkOrder(tx, wo.id, admin.id);

    const batches: { batchNumber: string; qtys: number[] }[] = [];
    for (const [q1, q2] of QTYS) {
      const batchNumber = await generateBatchNumberTx(tx, new Date());
      const batch = await tx.batch.create({
        data: { batchNumber, workOrderId: wo.id },
        select: { id: true, batchNumber: true },
      });
      for (const q of [q1, q2]) {
        const roll = await tx.roll.create({
          data: {
            barcode: null, // açık kumaş
            form: "ACIK",
            itemId: item.id,
            width: 150,
            initialQty: q,
            currentQty: q,
            status: RollStatus.IN_PRODUCTION,
            currentStepId: step.id,
            batchId: batch.id,
            entrySource: "SUBCONTRACTOR_RETURN", // fason dönüşü gibi: barkodsuz açık kumaşın doğal kaynağı
            createdById: admin.id,
          },
          select: { id: true },
        });
        // ⚠️ TAMBUR EKRANI ADIM LİSTESİNİ `RollMovement`TEN OKUR (getStep →
        // openMovements: workOrderStepId + exitedAt IS NULL), `currentStepId`den
        // DEĞİL. Hareket satırı olmadan kart "0 top · tüm toplar finalize" der
        // (2026-08-12'de bu script'in ilk sürümü tam böyle ısırdı).
        await tx.rollMovement.create({
          data: { rollId: roll.id, workOrderStepId: step.id, qtyIn: q },
        });
      }
      batches.push({ batchNumber: batch.batchNumber, qtys: [q1, q2] });
    }
    return { wo, batches };
  });

  console.log(`\n✅ Deneme iş emri hazır (${item.name} @ ${tambur.name}):\n`);
  console.log(`   İş Emri No : ${result.wo.workOrderNumber}`);
  for (const b of result.batches) {
    console.log(`   ${b.batchNumber} : ${b.qtys[0]} m + ${b.qtys[1]} m (2 açık kumaş)`);
  }
  console.log(`\n   → Tablet Tambur → Liste → "${result.wo.workOrderNumber}" kartını aç.\n`);
}

main()
  .catch((e) => { console.error("HATA:", e instanceof Error ? e.message : e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); process.exit(0); });
