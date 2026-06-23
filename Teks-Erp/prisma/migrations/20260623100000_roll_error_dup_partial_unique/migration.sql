-- RollError mükerrer-hata yarışı (Tambur + KK2 reportError) DB-level guard.
-- (rollId, startMeter, defectTypeId) iş-anahtarı tekil olmalı: findFirst→create
-- check-then-act'i eşzamanlı çift-tık/replay'de mükerrer açık-hata üretiyordu.
-- defectTypeId nullable → PARTIAL unique (WHERE defectTypeId IS NOT NULL).
-- Drift-free: schema.prisma'da @@index([rollId,startMeter,defectTypeId], map:...) var;
-- burada aynı isimli index UNIQUE+PARTIAL'a çevrilir (Prisma 7 partial predicate'i
-- drift saymaz). reportError'lar P2002'yi yakalayıp 409 DUPLICATE_ROLL_ERROR döner.
DROP INDEX IF EXISTS "roll_errors_roll_meter_defect_uq";
CREATE UNIQUE INDEX "roll_errors_roll_meter_defect_uq"
  ON "roll_errors" ("rollId", "startMeter", "defectTypeId")
  WHERE "defectTypeId" IS NOT NULL;
