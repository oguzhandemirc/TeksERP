-- =============================================================================
-- MAL-1 — MALİYET GİRDİLERİ + DOKUMA ÜRÜN YAPISI ÇEKİRDEĞİ (S2, seçenek B) — 2026-10-25
-- =============================================================================
-- TAMAMEN EKLEMELİ: yedi yeni tablo, üç yeni enum (CREATE TYPE aynı dosyada serbest —
-- tip burada DOĞUYOR, ADD VALUE değil) ve `items`e BEŞ nullable kolon (DEFAULT yok →
-- PG 11+ katalog değişikliği, tablo yeniden yazılmaz). Mevcut satırın davranışı değişmez.
--
-- ⚠️ `migrate dev --create-only` çıktısındaki iki `DropForeignKey` satırı (rolls/swatches
-- DEFERRABLE composite FK) SİLİNDİ — datamodel'de temsil edilemezler (test_schema_drift).
-- ⚠️ Partial unique'ler ŞEMA-DIŞIDIR (Prisma tek kolonlu FK'da @@unique'i 1:1 sanır):
-- envanter `test_db_invariants`, davranış `test_maliyet_girdileri`.
-- ⚠️ FK'lar `ON DELETE RESTRICT`: maliyet girdisi yaşayan ipliğin/kumaşın/fason firmanın
-- kalıcı silinmesini engeller (birleştirme haritası taşır).
-- Plan: docs/design/MALIYET-TEKLIF-PLAN.md §3.1–§3.2, §3.5.
-- =============================================================================

-- CreateEnum
CREATE TYPE "CostParamStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "YarnCostPriceSource" AS ENUM ('MANUAL', 'LAST_RECEIPT', 'PURCHASE_PRICE');

-- CreateEnum
CREATE TYPE "FinishingBasis" AS ENUM ('RAW_M', 'FINISHED_M');

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "composition" VARCHAR(200),
ADD COLUMN     "finishedGsm" DECIMAL(7,2),
ADD COLUMN     "rawGsm" DECIMAL(7,2),
ADD COLUMN     "rawWidthCm" DECIMAL(6,2),
ADD COLUMN     "weftSpecId" UUID;

-- CreateTable
CREATE TABLE "weft_specs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "picksPerCm" DECIMAL(6,2),
    "sequenceNote" VARCHAR(300),
    "notes" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "weft_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weft_spec_yarns" (
    "id" UUID NOT NULL,
    "weftSpecId" UUID NOT NULL,
    "yarnItemId" UUID NOT NULL,
    "picksInRepeat" INTEGER NOT NULL,
    "sortOrder" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weft_spec_yarns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_parameter_sets" (
    "id" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "CostParamStatus" NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMPTZ,
    "activatedById" UUID,
    "supersededAt" TIMESTAMPTZ,
    "note" VARCHAR(300),
    "loomHourRateTry" DECIMAL(12,4) NOT NULL,
    "laborHourRateTry" DECIMAL(12,4) NOT NULL,
    "loomsPerOperator" DECIMAL(6,2) NOT NULL,
    "energyKwhPerLoomHour" DECIMAL(8,3) NOT NULL,
    "energyPriceTryPerKwh" DECIMAL(10,4) NOT NULL,
    "overheadPct" DECIMAL(5,2) NOT NULL,
    "defaultTakeUpPct" DECIMAL(5,2),
    "defaultWarpWastePct" DECIMAL(5,2) NOT NULL,
    "defaultWeftWastePct" DECIMAL(5,2) NOT NULL,
    "defaultFabricWastePct" DECIMAL(5,2) NOT NULL,
    "defaultLoomRpm" INTEGER,
    "defaultEfficiencyPct" DECIMAL(5,2) NOT NULL,
    "beamPrepCostTry" DECIMAL(12,2) NOT NULL,
    "defaultBeamLengthM" DECIMAL(10,2) NOT NULL,
    "weftSelvedgeAllowanceCm" DECIMAL(6,2) NOT NULL,
    "defaultMarkupPct" DECIMAL(6,2) NOT NULL,
    "monthlyFinanceRatePct" DECIMAL(5,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "cost_parameter_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yarn_cost_prices" (
    "id" UUID NOT NULL,
    "yarnItemId" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "pricePerKg" DECIMAL(14,4) NOT NULL,
    "source" "YarnCostPriceSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" VARCHAR(64),
    "note" VARCHAR(300),
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,

    CONSTRAINT "yarn_cost_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finishing_rates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "subcontractorId" UUID,
    "basis" "FinishingBasis" NOT NULL,
    "currency" "Currency" NOT NULL,
    "pricePerM" DECIMAL(14,4) NOT NULL,
    "typicalShrinkPct" DECIMAL(5,2),
    "note" VARCHAR(300),
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,

    CONSTRAINT "finishing_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_structures" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "loomRpm" INTEGER,
    "efficiencyPct" DECIMAL(5,2),
    "warpWastePct" DECIMAL(5,2),
    "weftWastePct" DECIMAL(5,2),
    "fabricWastePct" DECIMAL(5,2),
    "weftLengthCm" DECIMAL(7,2),
    "beamLengthM" DECIMAL(10,2),
    "finishingRateCode" VARCHAR(32),
    "lengthShrinkPct" DECIMAL(5,2),
    "extraCostPerMTry" DECIMAL(12,4),
    "extraCostLabel" VARCHAR(100),
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "cost_structures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weft_specs_code_key" ON "weft_specs"("code");

-- Katlanmış arama gölgesi — değeri DB üretir (uygulama yazamaz, PG reddeder; WarpSpec emsali).
ALTER TABLE "weft_specs"
  ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;

-- CreateIndex
CREATE UNIQUE INDEX "weft_specs_nameFold_key" ON "weft_specs"("nameFold");

-- CreateIndex
CREATE INDEX "weft_spec_yarns_yarnItemId_idx" ON "weft_spec_yarns"("yarnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "weft_spec_yarns_weftSpecId_sortOrder_key" ON "weft_spec_yarns"("weftSpecId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "cost_parameter_sets_versionNo_key" ON "cost_parameter_sets"("versionNo");

-- CreateIndex
CREATE INDEX "cost_parameter_sets_status_idx" ON "cost_parameter_sets"("status");

-- CreateIndex
CREATE INDEX "yarn_cost_prices_yarnItemId_createdAt_idx" ON "yarn_cost_prices"("yarnItemId", "createdAt");

-- CreateIndex
CREATE INDEX "finishing_rates_code_createdAt_idx" ON "finishing_rates"("code", "createdAt");

-- CreateIndex
CREATE INDEX "finishing_rates_subcontractorId_idx" ON "finishing_rates"("subcontractorId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_structures_itemId_key" ON "cost_structures"("itemId");

-- CreateIndex
CREATE INDEX "items_weftSpecId_idx" ON "items"("weftSpecId");

-- AddForeignKey
ALTER TABLE "weft_specs" ADD CONSTRAINT "weft_specs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weft_specs" ADD CONSTRAINT "weft_specs_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weft_spec_yarns" ADD CONSTRAINT "weft_spec_yarns_weftSpecId_fkey" FOREIGN KEY ("weftSpecId") REFERENCES "weft_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weft_spec_yarns" ADD CONSTRAINT "weft_spec_yarns_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_weftSpecId_fkey" FOREIGN KEY ("weftSpecId") REFERENCES "weft_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_parameter_sets" ADD CONSTRAINT "cost_parameter_sets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_parameter_sets" ADD CONSTRAINT "cost_parameter_sets_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_cost_prices" ADD CONSTRAINT "yarn_cost_prices_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_cost_prices" ADD CONSTRAINT "yarn_cost_prices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finishing_rates" ADD CONSTRAINT "finishing_rates_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finishing_rates" ADD CONSTRAINT "finishing_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_structures" ADD CONSTRAINT "cost_structures_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_structures" ADD CONSTRAINT "cost_structures_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_structures" ADD CONSTRAINT "cost_structures_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- DB SEDLERİ — CHECK'ler (servis doğrulamasının ikinci hattı)
-- =============================================================================
ALTER TABLE "items" ADD CONSTRAINT "items_raw_width_cm_ck" CHECK ("rawWidthCm" IS NULL OR "rawWidthCm" > 0);
ALTER TABLE "items" ADD CONSTRAINT "items_gsm_ck" CHECK (("rawGsm" IS NULL OR "rawGsm" > 0) AND ("finishedGsm" IS NULL OR "finishedGsm" > 0));

ALTER TABLE "weft_specs" ADD CONSTRAINT "weft_specs_picks_per_cm_ck" CHECK ("picksPerCm" IS NULL OR "picksPerCm" > 0);
ALTER TABLE "weft_spec_yarns" ADD CONSTRAINT "weft_spec_yarns_picks_ck" CHECK ("picksInRepeat" > 0 AND "sortOrder" >= 0);

-- Parametre seti: yüzdeler 0 ≤ x < 100 · randıman 0 < x ≤ 100 · kâr 0–1000 · para ≥ 0 ·
-- tezgah başı operatör > 0 · levent boyu > 0 · devir > 0.
ALTER TABLE "cost_parameter_sets" ADD CONSTRAINT "cost_parameter_sets_pct_ck" CHECK (
  "overheadPct" >= 0 AND "overheadPct" < 100
  AND ("defaultTakeUpPct" IS NULL OR ("defaultTakeUpPct" >= 0 AND "defaultTakeUpPct" < 100))
  AND "defaultWarpWastePct" >= 0 AND "defaultWarpWastePct" < 100
  AND "defaultWeftWastePct" >= 0 AND "defaultWeftWastePct" < 100
  AND "defaultFabricWastePct" >= 0 AND "defaultFabricWastePct" < 100
  AND "defaultEfficiencyPct" > 0 AND "defaultEfficiencyPct" <= 100
  AND ("monthlyFinanceRatePct" IS NULL OR ("monthlyFinanceRatePct" >= 0 AND "monthlyFinanceRatePct" < 100))
  AND "defaultMarkupPct" >= 0 AND "defaultMarkupPct" <= 1000
);
ALTER TABLE "cost_parameter_sets" ADD CONSTRAINT "cost_parameter_sets_amount_ck" CHECK (
  "loomHourRateTry" >= 0 AND "laborHourRateTry" >= 0 AND "energyKwhPerLoomHour" >= 0
  AND "energyPriceTryPerKwh" >= 0 AND "beamPrepCostTry" >= 0 AND "weftSelvedgeAllowanceCm" >= 0
  AND "loomsPerOperator" > 0 AND "defaultBeamLengthM" > 0
  AND ("defaultLoomRpm" IS NULL OR "defaultLoomRpm" > 0)
);
-- Durum ↔ damga çifti: taslak damgasız; yürürlükteki yalnız activatedAt; eskimiş ikisini de taşır.
ALTER TABLE "cost_parameter_sets" ADD CONSTRAINT "cost_parameter_sets_stamp_ck" CHECK (
  ("status" = 'DRAFT' AND "activatedAt" IS NULL AND "supersededAt" IS NULL)
  OR ("status" = 'ACTIVE' AND "activatedAt" IS NOT NULL AND "supersededAt" IS NULL)
  OR ("status" = 'SUPERSEDED' AND "activatedAt" IS NOT NULL AND "supersededAt" IS NOT NULL)
);

ALTER TABLE "yarn_cost_prices" ADD CONSTRAINT "yarn_cost_prices_price_ck" CHECK ("pricePerKg" > 0);
ALTER TABLE "finishing_rates" ADD CONSTRAINT "finishing_rates_price_ck" CHECK (
  "pricePerM" >= 0 AND ("typicalShrinkPct" IS NULL OR ("typicalShrinkPct" >= 0 AND "typicalShrinkPct" < 100))
);

ALTER TABLE "cost_structures" ADD CONSTRAINT "cost_structures_values_ck" CHECK (
  ("loomRpm" IS NULL OR "loomRpm" > 0)
  AND ("efficiencyPct" IS NULL OR ("efficiencyPct" > 0 AND "efficiencyPct" <= 100))
  AND ("warpWastePct" IS NULL OR ("warpWastePct" >= 0 AND "warpWastePct" < 100))
  AND ("weftWastePct" IS NULL OR ("weftWastePct" >= 0 AND "weftWastePct" < 100))
  AND ("fabricWastePct" IS NULL OR ("fabricWastePct" >= 0 AND "fabricWastePct" < 100))
  AND ("lengthShrinkPct" IS NULL OR ("lengthShrinkPct" >= 0 AND "lengthShrinkPct" < 100))
  AND ("weftLengthCm" IS NULL OR "weftLengthCm" > 0)
  AND ("beamLengthM" IS NULL OR "beamLengthM" > 0)
  AND ("extraCostPerMTry" IS NULL OR "extraCostPerMTry" >= 0)
);

-- =============================================================================
-- ŞEMA-DIŞI PARTIAL UNIQUE'LER — yarışın son hattı (servis P2002 → 409 Türkçe)
-- =============================================================================
-- Tek yürürlükteki + tek taslak: TEK index iki tekilliği birden kurar (status değeri anahtar).
CREATE UNIQUE INDEX "cost_parameter_sets_live_uq" ON "cost_parameter_sets"("status")
  WHERE "status" IN ('DRAFT', 'ACTIVE');
-- İplik başına tek AKTİF maliyet fiyatı (damgalı geçmiş serbest).
CREATE UNIQUE INDEX "yarn_cost_prices_active_uq" ON "yarn_cost_prices"("yarnItemId")
  WHERE "revokedAt" IS NULL;
-- Tarife kodu başına tek AKTİF sürüm.
CREATE UNIQUE INDEX "finishing_rates_active_code_uq" ON "finishing_rates"("code")
  WHERE "revokedAt" IS NULL;
