/**
 * Tek seferlik backfill: aktif refakat kartı olmayan WO'lar için kart üret.
 *
 * Auto-create özelliği eklenmeden önce oluşturulan WO'lar bu script'le tamamlanır.
 * Idempotent — yeniden çalıştırılırsa zaten kartlı olanları atlar.
 *
 * Çalıştırma:
 *   npx ts-node scripts/backfill-traveler-cards.ts
 */

import "dotenv/config";
import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { WorkOrderStatus, TravelerCardStatus } from "@prisma/client";

async function main() {
  console.log("Backfill başlıyor — kartsız WO'lar aranıyor...");

  // Sadece PLANNED/IN_PROGRESS/PAUSED WO'lar — COMPLETED/CANCELLED'a
  // kart basmak iş kuralına aykırı (TravelerCardService.print kontrol ediyor).
  const eligibleWos = await prisma.workOrder.findMany({
    where: {
      status: {
        in: [
          WorkOrderStatus.PLANNED,
          WorkOrderStatus.IN_PROGRESS,
          WorkOrderStatus.PAUSED,
        ],
      },
      travelerCards: { none: { status: TravelerCardStatus.ACTIVE } },
    },
    select: { id: true, batchNumber: true, status: true },
  });

  console.log(`${eligibleWos.length} WO için kart eksik.`);

  if (eligibleWos.length === 0) {
    console.log("Yapılacak iş yok.");
    return;
  }

  const service = new TravelerCardService();
  let success = 0;
  let failed = 0;

  for (const wo of eligibleWos) {
    try {
      // Tx içinde — createForWorkOrder atomik olsun + nextMonthlySequence
      // race condition olursa retry mantığı barcode unique violation'da görür
      const card = await prisma.$transaction(async (tx) => {
        return service.createForWorkOrder(tx, wo.id);
      });
      console.log(`  ✓ ${wo.batchNumber} (${wo.status}) → ${card.cardNumber}`);
      success++;
    } catch (err) {
      console.error(
        `  ✗ ${wo.batchNumber} (${wo.status}): ${(err as Error).message}`
      );
      failed++;
    }
  }

  console.log(`\nTamamlandı: ${success} başarılı, ${failed} başarısız.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error("Hata:", err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
