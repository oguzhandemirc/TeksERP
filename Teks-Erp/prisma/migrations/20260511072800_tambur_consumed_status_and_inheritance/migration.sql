-- =============================================================================
-- Tambur "Bölündü" lifecycle + RollOperation kalıtım izi
-- =============================================================================
-- 1) RollStatus enum'una TAMBUR_CONSUMED ekle.
--    Tambur bölünmesinde parent retire edilirken kullanılır (currentQty=0,
--    tüm metraj çocuk topları olarak doğdu). SCRAP'ten ayrı: parent gerçekten
--    fire değil; fiziksel olarak çocuk topları halinde devam ediyor.
--
-- 2) roll_operations tablosuna inheritedFromParentRollId kolonu + FK + index.
--    Tambur'da çocuk top oluşurken parent'ın KURSUN_APPLIED / QC2_COMPLETED
--    operasyonları çocuğa kopyalanır; kopyada bu alan parent.id olur.
--    Aggregation/istatistik sorguları "WHERE inheritedFromParentRollId IS NULL"
--    filtresiyle çift sayımı önler.
-- =============================================================================

-- 1) Enum
ALTER TYPE "RollStatus" ADD VALUE 'TAMBUR_CONSUMED';

-- 2) Kalıtım kolonu
ALTER TABLE "roll_operations"
  ADD COLUMN "inheritedFromParentRollId" TEXT;

ALTER TABLE "roll_operations"
  ADD CONSTRAINT "roll_operations_inheritedFromParentRollId_fkey"
  FOREIGN KEY ("inheritedFromParentRollId") REFERENCES "rolls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "roll_operations_inheritedFromParentRollId_idx"
  ON "roll_operations" ("inheritedFromParentRollId");
