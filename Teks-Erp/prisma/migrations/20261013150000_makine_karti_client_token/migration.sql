-- Makine kartı kaydı idempotency (kk1.md): panel deneme başına clientToken taşır.
-- Replay sırrı yeniden üretmez (DB'de yalnız tohum) — yalnız kolon + unique index.

-- AlterTable
ALTER TABLE "machine_collectors" ADD COLUMN     "clientToken" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "machine_collectors_clientToken_key" ON "machine_collectors"("clientToken");
