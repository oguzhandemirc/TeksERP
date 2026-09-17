-- =============================================================================
-- FASON = CARİNİN ROLÜ — Subcontractor.customerId (kullanıcı kararı 2026-09-17)
-- =============================================================================
-- Fason kaydı bir cari kartına bağlı PROFİL olur (SAP BP kalıbı). Tablolar
-- BİRLEŞTİRİLMEZ, veri TAŞINMAZ. Bu dosya YALNIZ EKLER (ADDITIVE): bir nullable
-- kolon + tekil index + FK. Hiçbir kolon silinmez/adlanmaz; NULL = bağsız fason,
-- bugünkü davranış aynen. `migrate diff` çıktısındaki iki DEFERRABLE FK
-- (`rolls/swatches _sackId_shipmentId_consistency_fkey`) DROP satırı SİLİNDİ
-- (reçete: docs/RECETELER.md § migration, 1. adım). İdempotent (IF NOT EXISTS).
-- =============================================================================

-- AlterTable
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "customerId" UUID;

-- CreateIndex — bir cariye en çok BİR fason profili (NULL'lar tekilliğe girmez)
CREATE UNIQUE INDEX IF NOT EXISTS "subcontractors_customerId_key" ON "subcontractors"("customerId");

-- AddForeignKey — cari SİLİNMEZ (soft delete); SET NULL yalnız Prisma varsayılanıdır
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractors_customerId_fkey') THEN
    ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
