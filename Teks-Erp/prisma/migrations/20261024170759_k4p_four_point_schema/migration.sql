-- K4P-SEMA (2026-10-24) — 4 puan muayene şeması (docs/design/KALITE-4PUAN-PLAN.md §3.1–§3.4).
-- Bu dilimde INSPECTION satırı yazan yol YOK (yazar MOTOR dilimi) → davranış farkı sıfır.
-- Ekleyici: mevcut roll_errors satırları `origin` sabit DEFAULT'u alır (PG 11+ tablo
-- yeniden yazmaz — metadata default; ölçüldü, PR gövdesi). `DropForeignKey` satırları
-- (prisma diff gürültüsü: composite DEFERRABLE FK'lar) SİLİNDİ.

-- CreateEnum
CREATE TYPE "RollErrorOrigin" AS ENUM ('PROCESS', 'INSPECTION');

-- CreateEnum
CREATE TYPE "FourPointSize" AS ENUM ('UP_TO_3IN', 'IN_3_TO_6', 'IN_6_TO_9', 'OVER_9IN');

-- CreateEnum
CREATE TYPE "InspectionPhase" AS ENUM ('RAW', 'FINAL');

-- CreateEnum
CREATE TYPE "InspectionWidthSource" AS ENUM ('ITEM_CARD', 'ROLL_MEASURED', 'MANUAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RuleScope" AS ENUM ('FACTORY', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ScoreUnit" AS ENUM ('M2', 'YD2');

-- CreateEnum
CREATE TYPE "RunningCap" AS ENUM ('NONE', 'METER', 'YARD');

-- AlterTable
ALTER TABLE "defect_types" ADD COLUMN     "fixedPoints" SMALLINT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "widthCm" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "roll_errors" ADD COLUMN     "inspectionId" UUID,
ADD COLUMN     "origin" "RollErrorOrigin" NOT NULL DEFAULT 'PROCESS',
ADD COLUMN     "points" SMALLINT,
ADD COLUMN     "sizeClass" "FourPointSize",
ALTER COLUMN "startMeter" DROP NOT NULL;

-- CreateTable
CREATE TABLE "roll_inspections" (
    "id" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "phase" "InspectionPhase" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" UUID,
    "stationId" UUID,
    "deviceId" UUID,
    "inspectedLengthM" DECIMAL(12,3) NOT NULL,
    "widthCm" DECIMAL(8,2),
    "widthSource" "InspectionWidthSource" NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "defectCount" INTEGER NOT NULL,
    "unplacedDefectCount" INTEGER NOT NULL,
    "pointsPer100M2" DECIMAL(8,2),
    "ruleSetId" UUID,
    "ruleSnapshot" JSONB NOT NULL,
    "gradeScore" DECIMAL(8,2),
    "suggestedQualityGradeId" UUID,
    "suggestedGradeCode" VARCHAR(32),
    "gradeMismatch" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "reviseReason" TEXT,
    "inspectedById" UUID NOT NULL,
    "inspectedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ,
    "supersededById" UUID,
    "voidedAt" TIMESTAMPTZ,
    "voidedById" UUID,
    "voidReason" TEXT,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roll_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "four_point_rule_sets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "scope" "RuleScope" NOT NULL,
    "customerId" UUID,
    "itemId" UUID,
    "unit" "ScoreUnit" NOT NULL DEFAULT 'M2',
    "runningCap" "RunningCap" NOT NULL DEFAULT 'YARD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "four_point_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "four_point_rule_bands" (
    "id" UUID NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "maxScore" DECIMAL(8,2),
    "label" VARCHAR(16) NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "qualityGradeId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "four_point_rule_bands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roll_inspections_supersedesId_key" ON "roll_inspections"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "roll_inspections_clientToken_key" ON "roll_inspections"("clientToken");

-- CreateIndex
CREATE INDEX "roll_inspections_rollId_idx" ON "roll_inspections"("rollId");

-- CreateIndex
CREATE INDEX "roll_inspections_inspectedAt_idx" ON "roll_inspections"("inspectedAt");

-- CreateIndex
CREATE INDEX "roll_inspections_suggestedQualityGradeId_idx" ON "roll_inspections"("suggestedQualityGradeId");

-- CreateIndex
CREATE INDEX "roll_inspections_ruleSetId_idx" ON "roll_inspections"("ruleSetId");

-- CreateIndex
CREATE INDEX "roll_inspections_inspectedById_inspectedAt_idx" ON "roll_inspections"("inspectedById", "inspectedAt");

-- CreateIndex
CREATE INDEX "roll_inspections_stationId_idx" ON "roll_inspections"("stationId");

-- CreateIndex
CREATE INDEX "roll_inspections_deviceId_idx" ON "roll_inspections"("deviceId");

-- CreateIndex
-- PARTIAL: (top, faz) başına tek AKTİF muayene — eşzamanlı ikinci "ilk muayene"nin
-- DB seddi (P2002 → 409 INSPECTION_ALREADY_ACTIVE, MOTOR). Şemada @@unique(map:).
CREATE UNIQUE INDEX "roll_inspections_one_active_uq" ON "roll_inspections"("rollId", "phase")
  WHERE "supersededAt" IS NULL AND "voidedAt" IS NULL;

-- CreateIndex
CREATE INDEX "four_point_rule_sets_itemId_idx" ON "four_point_rule_sets"("itemId");

-- CreateIndex
-- PARTIAL: tek aktif FACTORY seti.
CREATE UNIQUE INDEX "four_point_rule_sets_one_factory_uq" ON "four_point_rule_sets"("scope")
  WHERE "scope" = 'FACTORY' AND "isActive" = true;

-- CreateIndex
-- PARTIAL ikilisi = aktif (customerId, COALESCE(itemId, sıfır-uuid)) tekilliği; ifade
-- index'i yerine iki partial (drift bekçisi ifadeyi göremez, predicate'i saymaz).
CREATE UNIQUE INDEX "four_point_rule_sets_customer_uq" ON "four_point_rule_sets"("customerId", "scope")
  WHERE "isActive" = true AND "customerId" IS NOT NULL AND "itemId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "four_point_rule_sets_customer_item_uq" ON "four_point_rule_sets"("customerId", "itemId")
  WHERE "isActive" = true AND "itemId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "four_point_rule_bands_qualityGradeId_idx" ON "four_point_rule_bands"("qualityGradeId");

-- CreateIndex
CREATE UNIQUE INDEX "four_point_rule_bands_ruleSetId_sortOrder_key" ON "four_point_rule_bands"("ruleSetId", "sortOrder");

-- CreateIndex
CREATE INDEX "roll_errors_inspectionId_idx" ON "roll_errors"("inspectionId");

-- CreateIndex
CREATE INDEX "roll_errors_rollId_origin_idx" ON "roll_errors"("rollId", "origin");

-- AddForeignKey
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "four_point_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_suggestedQualityGradeId_fkey" FOREIGN KEY ("suggestedQualityGradeId") REFERENCES "quality_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "four_point_rule_sets" ADD CONSTRAINT "four_point_rule_sets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "four_point_rule_sets" ADD CONSTRAINT "four_point_rule_sets_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "four_point_rule_sets" ADD CONSTRAINT "four_point_rule_sets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "four_point_rule_sets" ADD CONSTRAINT "four_point_rule_sets_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "four_point_rule_bands" ADD CONSTRAINT "four_point_rule_bands_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "four_point_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "four_point_rule_bands" ADD CONSTRAINT "four_point_rule_bands_qualityGradeId_fkey" FOREIGN KEY ("qualityGradeId") REFERENCES "quality_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Elle: CHECK seddi (Prisma ifade edemez; envanter `test_db_invariants`) ──────────

-- PROCESS satırının metre garantisi DB'de kalır; NULL metre yalnız muayene satırında.
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_meter_ck"
  CHECK ("startMeter" IS NOT NULL OR "origin" = 'INSPECTION');
-- Tek hata en fazla 4 puan (ASTM D5430).
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_points_ck"
  CHECK ("points" IS NULL OR "points" BETWEEN 1 AND 4);
-- Muayene satırı belgeye bağlı, puanlı ve Tambur kararı ALMAZ.
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_inspection_ck"
  CHECK ("origin" <> 'INSPECTION' OR ("inspectionId" IS NOT NULL AND "points" IS NOT NULL
         AND "isProcessed" = false AND "actionTaken" IS NULL));

ALTER TABLE "defect_types" ADD CONSTRAINT "defect_types_fixed_points_ck"
  CHECK ("fixedPoints" IS NULL OR "fixedPoints" BETWEEN 1 AND 4);
ALTER TABLE "items" ADD CONSTRAINT "items_width_cm_ck"
  CHECK ("widthCm" IS NULL OR "widthCm" > 0);

ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_counts_ck"
  CHECK ("totalPoints" >= 0 AND "defectCount" >= 0
         AND "unplacedDefectCount" BETWEEN 0 AND "defectCount");
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_length_ck"
  CHECK ("inspectedLengthM" > 0);
-- En bilinmiyorsa (UNKNOWN) kolon boş; biliniyorsa pozitif.
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_width_ck"
  CHECK ((("widthSource" = 'UNKNOWN') = ("widthCm" IS NULL)) AND ("widthCm" IS NULL OR "widthCm" > 0));
-- Bir belge ya revizyonla ya iptalle kapanır, ikisiyle birden değil.
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_stamp_ck"
  CHECK ("supersededAt" IS NULL OR "voidedAt" IS NULL);
-- Revizyon zinciri: ilk revizyonun öncülü yok, sonrakilerin var.
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_revision_ck"
  CHECK ("revision" >= 1 AND (("revision" = 1) = ("supersedesId" IS NULL)));

ALTER TABLE "four_point_rule_sets" ADD CONSTRAINT "four_point_rule_sets_scope_ck"
  CHECK ((("scope" = 'FACTORY') = ("customerId" IS NULL)) AND ("itemId" IS NULL OR "customerId" IS NOT NULL));
ALTER TABLE "four_point_rule_bands" ADD CONSTRAINT "four_point_rule_bands_max_score_ck"
  CHECK ("maxScore" IS NULL OR "maxScore" >= 0);

-- Mükerrer-hata seddi yalnız saha (PROCESS) yarışına: muayene revizyonu aynı
-- (top, metre, tür) üçlüsünü yeni revizyonda YENİDEN yazar. Predicate değişimi drift değildir.
DROP INDEX IF EXISTS "roll_errors_roll_meter_defect_uq";
CREATE UNIQUE INDEX "roll_errors_roll_meter_defect_uq" ON "roll_errors"("rollId", "startMeter", "defectTypeId")
  WHERE "defectTypeId" IS NOT NULL AND "origin" = 'PROCESS';
