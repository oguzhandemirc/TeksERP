-- =============================================================================
-- Gülkesim parti no + kurşun metresi S0 (2026-11-02) — şema temeli, DAVRANIŞ YOK
-- =============================================================================
-- Tasarım: ~/.tekserp/gulkesim/PARTI-METRE-TASARIM-2026-11-02.md §2.3, §2.4, §2.6, §3 S0.
-- TAMAMEN EKLEMELİ: yeni enum (CREATE TYPE — tip burada doğuyor, ADD VALUE değil), mevcut tablolara
-- nullable kolon ya da SABİT varsayılanlı NOT NULL kolon (PG 11+: katalog değişikliği, tablo yeniden
-- yazılmaz). Toplu UPDATE/DELETE YOK; mevcut parti `SERIES`, mevcut taslak `kursunMetersReview=false` okunur
-- = bugünkü davranış. `INFO` satır durumu ayrı dosyada (20261102085911, ADD VALUE kuralı).
-- ⚠️ `migrate dev --create-only` çıktısındaki iki `DropForeignKey` satırı (rolls/swatches DEFERRABLE
-- composite FK) SİLİNDİ — datamodel'de temsil edilemezler (test_schema_drift).
-- ⚠️ İki CHECK ŞEMA-DIŞIDIR → envanter `test_db_invariants` §2.
-- =============================================================================

-- CreateEnum
CREATE TYPE "BatchNumberSource" AS ENUM ('SERIES', 'DOCUMENT');

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "numberSource" "BatchNumberSource" NOT NULL DEFAULT 'SERIES';

-- AlterTable
ALTER TABLE "customer_delivery_notes" ADD COLUMN     "kursunMeters" DECIMAL(12,3),
ADD COLUMN     "kursunMetersReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kursunMetersSource" VARCHAR(16),
ADD COLUMN     "ourBatchNo" VARCHAR(64),
ADD COLUMN     "ourBatchNoKey" VARCHAR(32);

-- AlterTable
ALTER TABLE "sender_templates" ADD COLUMN     "batchNoKey" VARCHAR(32);

-- Kurşun metresi pozitif (satır metresi `customer_delivery_note_lines_meters_ck` emsali); NULL = henüz yok.
ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_kursun_meters_ck"
  CHECK ("kursunMeters" IS NULL OR "kursunMeters" > 0);

-- Kaynak kapalı küme ve metreyle birlikte dolu/boş: kaynaksız metre onay kapısının dalını (LINE_SUM mı) belirsiz bırakır.
ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_kursun_source_ck"
  CHECK (
    ("kursunMetersSource" IS NULL OR "kursunMetersSource" IN ('OUTPUT', 'TOTAL', 'LINE_SUM', 'MANUAL'))
    AND (("kursunMeters" IS NULL) = ("kursunMetersSource" IS NULL))
  );
