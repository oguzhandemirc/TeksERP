-- Kök kuyruğu talebinin düşme nedeni (imza planının KUYRUK nedeni). Eski satırlar türetilerek doldurulur:
-- yetenek düşüşü (sistem) → YETENEK_YOK; portal talebi → kurulum hak-ara bildiriyorsa ya da hiç etkinleşmediyse
-- ARA_IMZACI_YOK (beklenen yetenek), değilse YETENEK_YOK. Sonra NOT NULL.
-- CreateEnum
CREATE TYPE "HakKokTalebiNedeni" AS ENUM ('YETENEK_YOK', 'ARA_IMZACI_YOK');

-- AlterTable
ALTER TABLE "hak_kok_talebi" ADD COLUMN "planNedeni" "HakKokTalebiNedeni";

UPDATE "hak_kok_talebi" t
SET "planNedeni" = CASE
  WHEN t."yapan" = 'sistem:yetenek-dususu' THEN 'YETENEK_YOK'::"HakKokTalebiNedeni"
  WHEN 'hak-ara' = ANY (k."yetenekler") OR (k."durum" = 'ETKINLESMEDI' AND cardinality(k."yetenekler") = 0) THEN 'ARA_IMZACI_YOK'::"HakKokTalebiNedeni"
  ELSE 'YETENEK_YOK'::"HakKokTalebiNedeni"
END
FROM "kurulum" k
WHERE k."id" = t."kurulumId";

ALTER TABLE "hak_kok_talebi" ALTER COLUMN "planNedeni" SET NOT NULL;
