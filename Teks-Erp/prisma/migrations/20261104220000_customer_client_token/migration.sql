-- Gülkesim 2026-11-04: belgeden İE formunda hızlı müşteri kaydı — `clientToken @unique` idempotency sözleşmesi.
-- Nullable: mevcut kartlar NULL kalır (bugünkü davranış). Geri alınamaz (yalnız ekleme).
ALTER TABLE "customers" ADD COLUMN "clientToken" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "customers_clientToken_key" ON "customers"("clientToken");
