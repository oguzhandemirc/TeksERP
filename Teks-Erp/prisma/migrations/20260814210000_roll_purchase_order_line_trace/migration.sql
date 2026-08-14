-- Roll → PurchaseOrderLine izi (J2, "top→sipariş kalemi izi" kararı).
-- Nullable kolon + SET NULL FK → PG11+'ta metadata-only (tablo yeniden yazılmaz).
-- SET NULL gerekçesi schema.prisma'daki alan yorumunda: iz ≠ defter; PO kalemi
-- replace akışında gerçekten silinir ve izin NULL'a düşmesi kilitten iyidir.
ALTER TABLE "rolls" ADD COLUMN "purchaseOrderLineId" UUID;

ALTER TABLE "rolls" ADD CONSTRAINT "rolls_purchaseOrderLineId_fkey"
  FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- PARTIAL index — goodsReceiptId ile aynı desen (null-yoğun kolon, perf kuralı 4).
-- Şemada @@index tam görünür; Prisma 7 predicate farkını drift saymaz.
-- test_db_invariants beklenen listesine AYNI commit'te eklendi.
CREATE INDEX "rolls_purchaseOrderLineId_idx" ON "rolls"("purchaseOrderLineId")
  WHERE "purchaseOrderLineId" IS NOT NULL;
