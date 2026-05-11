-- =============================================================================
-- Packaging Queue: rulo seviyesine taşı
-- =============================================================================
-- Eski model: bir sipariş için aktif tek satır; operatör siparişi alır, depoda
-- hangi rulları çekeceğine kendisi karar verir.
-- Yeni model: planlamacı depodaki her bir rulayı bir siparişe (veya stoğa)
-- atar. Bir satır = bir rulonun paketleme görevi. Operatör doğrudan ruloyu
-- alır; karar zaten planlamacıda alınmış olur.
--
-- DİKKAT: Tablo TRUNCATE edilir — orderId → rollId rota değiştiği için mevcut
-- satırlar anlamlı taşınamaz. Test verisi, sıfırlama kabul.
-- =============================================================================

TRUNCATE TABLE "packaging_queue";

-- Eski partial unique, FK ve index'i düşür
DROP INDEX IF EXISTS "packaging_queue_active_order_uq";
ALTER TABLE "packaging_queue" DROP CONSTRAINT IF EXISTS "packaging_queue_orderId_fkey";
DROP INDEX IF EXISTS "packaging_queue_orderId_idx";

-- orderId → plannedOrderId; nullable yap (stoğa paketleme için)
ALTER TABLE "packaging_queue" RENAME COLUMN "orderId" TO "plannedOrderId";
ALTER TABLE "packaging_queue" ALTER COLUMN "plannedOrderId" DROP NOT NULL;

-- Yeni FK: planlanan sipariş (silinirse atama düşer, kuyruk satırı stoğa döner)
ALTER TABLE "packaging_queue"
  ADD CONSTRAINT "packaging_queue_plannedOrderId_fkey"
  FOREIGN KEY ("plannedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "packaging_queue_plannedOrderId_idx"
  ON "packaging_queue"("plannedOrderId");

-- Yeni kolon: rollId (NOT NULL — tablo boş, sorun yok)
ALTER TABLE "packaging_queue" ADD COLUMN "rollId" TEXT NOT NULL;

ALTER TABLE "packaging_queue"
  ADD CONSTRAINT "packaging_queue_rollId_fkey"
  FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "packaging_queue_rollId_idx"
  ON "packaging_queue"("rollId");

-- Yeni partial unique: aktif satırlarda bir rulo aynı anda iki kuyruk
-- girdisinde olamaz (WAITING + TAKEN aktif). DONE/CANCELLED tarihçe.
CREATE UNIQUE INDEX "packaging_queue_active_roll_uq"
  ON "packaging_queue"("rollId")
  WHERE "status" IN ('WAITING', 'TAKEN');
