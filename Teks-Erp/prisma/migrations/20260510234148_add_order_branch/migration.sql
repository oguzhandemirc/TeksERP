-- =============================================================================
-- Order.branchId — Siparişin hedef şubesi
-- =============================================================================
-- Yeni sipariş girişinde planlamacı hangi şubeye gideceğini seçer. Mevcut
-- siparişler null kalır (geriye dönük uyum). Sevkiyat oluştururken default
-- branch olarak kullanılır; flexible shipping ruhuyla sevkiyatta override
-- edilebilir.
-- =============================================================================

ALTER TABLE "orders"
ADD COLUMN "branchId" TEXT;

ALTER TABLE "orders"
ADD CONSTRAINT "orders_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_branchId_idx" ON "orders"("branchId");
