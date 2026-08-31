-- G2 (2026-08-14): Alış siparişi SHORT-CLOSE ("kalanı kapat").
-- Üç nullable kolon → PG11+ metadata-only, tablo yeniden yazılmaz.
-- ⚠️ `migrate diff` çıktısındaki iki DropForeignKey satırı
-- (rolls/swatches `_sackId_shipmentId_consistency_fkey`) bilinen drift
-- tuzağıdır ve BİLEREK bu dosyaya alınmadı (schema.prisma:2557-2558 notu).
-- `shortClosedById` düşük-trafik audit FK — bilinçli indexsiz (perf kuralı 1
-- istisnası; `createdById`/`cancelledById` emsali).

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "shortCloseReason" VARCHAR(300),
ADD COLUMN     "shortClosedAt" TIMESTAMPTZ,
ADD COLUMN     "shortClosedById" UUID;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_shortClosedById_fkey" FOREIGN KEY ("shortClosedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
