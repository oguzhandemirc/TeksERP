-- Refakat Kartı: PARTİ başına → İŞ EMRİ başına (2026-07-14 redesign).
-- Tek-kod: cardNumber = barcode = workOrderNumber (İE). Karekod versiyonlar arası sabit.
-- Parti (Batch) veri modeli kalır ama kart üretmez; kart WO açılışında doğar.
-- IDEMPOTENT: Prisma statement'ları tek tx'te çalışmadığından kısmi uygulamaya
-- karşı her adım IF EXISTS / IF NOT EXISTS / NOT EXISTS ile korumalı.

-- 1) workOrderId kolonu (önce NULLABLE — backfill için)
ALTER TABLE "traveler_cards" ADD COLUMN IF NOT EXISTS "workOrderId" UUID;

-- 2) Backfill: kartın partisinin iş emrinden çöz (batchId hâlâ varsa)
UPDATE "traveler_cards" tc
SET "workOrderId" = b."workOrderId"
FROM "batches" b
WHERE tc."batchId" = b.id AND tc."workOrderId" IS NULL;

-- 2b) batchId artık zorunlu değil (aşağıda silinecek) — kartsız WO insert'i NULL batchId ile geçsin.
ALTER TABLE "traveler_cards" ALTER COLUMN "batchId" DROP NOT NULL;

-- 3) Dedup: WO başına EN YENİ kart SURVIVOR; diğerlerinin taramaları survivor'a taşınır, kendileri silinir.
WITH survivors AS (
  SELECT DISTINCT ON ("workOrderId") "workOrderId", id AS survivor_id
  FROM "traveler_cards"
  WHERE "workOrderId" IS NOT NULL
  ORDER BY "workOrderId", version DESC, "printedAt" DESC
)
UPDATE "traveler_card_scans" s
SET "cardId" = sv.survivor_id
FROM "traveler_cards" t
JOIN survivors sv ON sv."workOrderId" = t."workOrderId"
WHERE s."cardId" = t.id AND t.id <> sv.survivor_id;

DELETE FROM "traveler_cards" tc
USING (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY "workOrderId" ORDER BY version DESC, "printedAt" DESC
    ) rn
    FROM "traveler_cards"
    WHERE "workOrderId" IS NOT NULL
  ) r WHERE rn > 1
) dup
WHERE tc.id = dup.id;

-- 4) Barkod + kart no = iş emri no (İE). WO no benzersiz → barcode/cardNumber unique korunur.
UPDATE "traveler_cards" tc
SET barcode = w."workOrderNumber", "cardNumber" = w."workOrderNumber"
FROM "work_orders" w
WHERE tc."workOrderId" = w.id;

-- 5) Kartsız iş emirlerine kart üret (kart WO başına — hepsinde olmalı). Durum WO'ya göre.
INSERT INTO "traveler_cards"
  (id, "cardNumber", barcode, "workOrderId", version, status, "printedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(), w."workOrderNumber", w."workOrderNumber", w.id, 1,
  (CASE w.status
     WHEN 'COMPLETED' THEN 'COMPLETED'
     WHEN 'CANCELLED' THEN 'VOIDED'
     ELSE 'ACTIVE' END)::"TravelerCardStatus",
  now(), now(), now()
FROM "work_orders" w
WHERE w."isActive"
  AND NOT EXISTS (SELECT 1 FROM "traveler_cards" t WHERE t."workOrderId" = w.id);

-- 6) Artık her satırda workOrderId var → NOT NULL
ALTER TABLE "traveler_cards" ALTER COLUMN "workOrderId" SET NOT NULL;

-- 7) Eski batchId kısıtları/indexleri düş
DROP INDEX IF EXISTS "traveler_cards_batch_active_uniq";
DROP INDEX IF EXISTS "traveler_cards_batchId_idx";
ALTER TABLE "traveler_cards" DROP CONSTRAINT IF EXISTS "traveler_cards_batchId_fkey";
ALTER TABLE "traveler_cards" DROP COLUMN IF EXISTS "batchId";

-- 8) workOrderId unique (bir WO = tek kart) + FK
CREATE UNIQUE INDEX IF NOT EXISTS "traveler_cards_workOrderId_key" ON "traveler_cards"("workOrderId");
ALTER TABLE "traveler_cards" DROP CONSTRAINT IF EXISTS "traveler_cards_workOrderId_fkey";
ALTER TABLE "traveler_cards"
  ADD CONSTRAINT "traveler_cards_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
