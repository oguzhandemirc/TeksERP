-- =============================================================================
-- SackAllocation DAMGA (K2, 2026-09-14) — tahsis sil-yaz'dan çıkıyor
-- =============================================================================
-- `sack_allocations` sipariş karşılamasını belirleyen TİCARİ pivottur (defter.md ③a):
-- yeniden hesap eski satırı SİLMEZ, `clearedAt` (+ `clearedShipmentId` · `clearedById`)
-- ile damgalar (`SackTagAssignment.clearedAt` deseni). Okuyan her yol `ACTIVE_ALLOCATION`
-- (`"clearedAt" IS NULL`) süzer.
--
-- Tam unique `sack_allocations_sackId_orderLineId_key` damgalı satır dururken aynı
-- (çuval, satır)ın yeniden tahsisini engellerdi → PARTIAL UNIQUE (yalnız etkin satır).
-- ⚠️ Prisma `@@unique` CONSTRAINT değil INDEX üretir: `DROP INDEX` (DROP CONSTRAINT
-- IF EXISTS sessizce hiçbir şey yapmaz). Prisma şemasında `@@unique` düşürüldü;
-- partial index şema-dışıdır, envanteri `scripts/test_db_invariants.ts`.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.
-- Add-only: var olan satırlar damgasız (etkin) kalır — bugünkü anlam korunur.

-- AlterTable
ALTER TABLE "sack_allocations" ADD COLUMN     "clearedAt" TIMESTAMPTZ,
ADD COLUMN     "clearedShipmentId" UUID,
ADD COLUMN     "clearedById" UUID;

-- AddForeignKey
ALTER TABLE "sack_allocations" ADD CONSTRAINT "sack_allocations_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tam unique → partial unique (yalnız etkin satır)
DROP INDEX IF EXISTS "sack_allocations_sackId_orderLineId_key";
CREATE UNIQUE INDEX "sack_allocations_active_uq" ON "sack_allocations"("sackId", "orderLineId") WHERE "clearedAt" IS NULL;

-- CreateIndex (unique'in sol-prefix'i düştü; `clearedAt` süzgeci her okumada)
CREATE INDEX "sack_allocations_sackId_idx" ON "sack_allocations"("sackId");
CREATE INDEX "sack_allocations_clearedAt_idx" ON "sack_allocations"("clearedAt");
