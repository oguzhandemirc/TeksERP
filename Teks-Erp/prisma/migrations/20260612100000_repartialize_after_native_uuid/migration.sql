-- REPARTIALIZE: 20260611084953_native_uuid_pk_fk migration'ı FK kolonlarını
-- DROP COLUMN + ADD COLUMN ile yeniden yarattığı için, bu kolonlara bağlı
-- elle yazılmış PARTIAL indeksler kolonla birlikte düştü ve Prisma onları
-- WHERE'siz (FULL) olarak yeniden yarattı. Bu migration 9 indeksi önceki
-- migration'lardaki (20260606001717, 20260607010000, 20260609120000,
-- 20260609221328) orijinal partial tanımlarına geri döndürür.
--
-- ⚠️ KURAL: Bu kolonlara dokunan (tip değiştiren / yeniden yaratan) her
-- gelecekteki Prisma-üretimi migration partial'ları SESSİZCE sıfırlar —
-- migration üretildikten sonra etkilenen indeksler için bu dosyadaki ilgili
-- blok elle migration sonuna kopyalanmalı. (Prisma 7 partial predicate'i
-- şemada taşımaz; @@index aynı kolonlarla durur, predicate drift sayılmaz.)
--
-- Hayatta kalanlar (kolonlarına dokunulmadı, burada YOK):
--   rolls_batchSplitId_idx, rolls_markedForKartela_idx, swatches_createdAt_idx
SET statement_timeout = 0;

-- 20260606001717: null-yoğun rolls FK indeksleri (ölçüm: 300k satırda %20 insert kazanımı)
DROP INDEX IF EXISTS "rolls_sackId_idx";
CREATE INDEX "rolls_sackId_idx" ON "rolls" ("sackId") WHERE "sackId" IS NOT NULL;

DROP INDEX IF EXISTS "rolls_shipmentId_idx";
CREATE INDEX "rolls_shipmentId_idx" ON "rolls" ("shipmentId") WHERE "shipmentId" IS NOT NULL;

DROP INDEX IF EXISTS "rolls_parentReceiptId_idx";
CREATE INDEX "rolls_parentReceiptId_idx" ON "rolls" ("parentReceiptId") WHERE "parentReceiptId" IS NOT NULL;

-- 20260609120000: null-yoğun swatches/sacks FK indeksleri
DROP INDEX IF EXISTS "swatches_parentReceiptId_idx";
CREATE INDEX "swatches_parentReceiptId_idx" ON "swatches" ("parentReceiptId") WHERE "parentReceiptId" IS NOT NULL;

DROP INDEX IF EXISTS "swatches_shipmentId_idx";
CREATE INDEX "swatches_shipmentId_idx" ON "swatches" ("shipmentId") WHERE "shipmentId" IS NOT NULL;

DROP INDEX IF EXISTS "swatches_sackId_idx";
CREATE INDEX "swatches_sackId_idx" ON "swatches" ("sackId") WHERE "sackId" IS NOT NULL;

DROP INDEX IF EXISTS "sacks_shipmentId_idx";
CREATE INDEX "sacks_shipmentId_idx" ON "sacks" ("shipmentId") WHERE "shipmentId" IS NOT NULL;

-- 20260609221328: WO split lineage
DROP INDEX IF EXISTS "work_orders_splitFromId_idx";
CREATE INDEX "work_orders_splitFromId_idx" ON "work_orders"("splitFromId") WHERE "splitFromId" IS NOT NULL;

-- 20260607010000: açık-kart kuyruğu (15sn'de bir poll edilir; COMPLETED yığını
-- indekste hiç yer almaz → sorgu O(açık step))
DROP INDEX IF EXISTS "work_order_steps_stationId_status_isUrgent_priority_started_idx";
CREATE INDEX "work_order_steps_stationId_status_isUrgent_priority_started_idx"
  ON "work_order_steps" ("stationId", "status", "isUrgent", "priority", "startedAt")
  WHERE status <> 'COMPLETED';
