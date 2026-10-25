-- =============================================================================
-- MAL-2 — STANDART MALİYET SÜRÜMÜ (`standard_cost_versions` + `standard_cost_lines`) — 2026-10-25
-- =============================================================================
-- NE YAPAR: iki yeni tablo, iki yeni enum (CREATE TYPE — tip burada DOĞUYOR, ADD VALUE değil),
-- tek-ACTIVE partial unique ve CHECK seddi. ADDITIVE: mevcut tabloya kolon/satır dokunulmaz,
-- mevcut kurulumun davranışı değişmez (tablolar boş doğar; yazan yalnız `POST /api/cost/items/:id/versions`).
--
-- ⚠️ `migrate dev --create-only` çıktısındaki iki `DropForeignKey` satırı (rolls/swatches
-- DEFERRABLE composite FK) SİLİNDİ — datamodel'de temsil edilemezler (test_schema_drift).
-- ⚠️ Partial unique ŞEMA-DIŞI (Prisma tek kolonda @@unique'i 1:1 sanar): envanter
-- `test_db_invariants`, davranış `test_standart_maliyet_surum` §2 (iki paralel kayıt → tek ACTIVE).
-- ⚠️ FK'lar `ON DELETE RESTRICT`: donmuş fotoğraf silinmez; ürün/iplik/parametre seti onu
-- referans aldıkça kalıcı silinemez (birleştirme haritası taşır).
-- Plan: docs/design/MALIYET-TEKLIF-PLAN.md §3.2, §3.5.
-- =============================================================================

-- CreateEnum
CREATE TYPE "StandardCostStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CostComponent" AS ENUM ('WARP_YARN', 'WEFT_YARN', 'LOOM_MACHINE', 'LOOM_LABOR', 'ENERGY', 'BEAM_PREP', 'FINISHING', 'LENGTH_SHRINK', 'FABRIC_WASTE', 'OVERHEAD', 'EXTRA');

-- CreateTable
CREATE TABLE "standard_cost_versions" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "StandardCostStatus" NOT NULL DEFAULT 'ACTIVE',
    "parameterSetId" UUID NOT NULL,
    "rawCostPerMTry" DECIMAL(14,4) NOT NULL,
    "finishedCostPerMTry" DECIMAL(14,4),
    "totalCostPerMTry" DECIMAL(14,4) NOT NULL,
    "warpKgPerM" DECIMAL(14,6) NOT NULL,
    "weftKgPerM" DECIMAL(14,6) NOT NULL,
    "loomMPerHour" DECIMAL(10,4) NOT NULL,
    "fxRates" JSONB NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "warnings" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(300),
    "restoredFromId" UUID,
    "supersededAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,

    CONSTRAINT "standard_cost_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_cost_lines" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "component" "CostComponent" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "yarnItemId" UUID,
    "qty" DECIMAL(14,6),
    "qtyUnit" VARCHAR(16),
    "unitPriceTry" DECIMAL(14,4),
    "amountPerMTry" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "standard_cost_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "standard_cost_versions_parameterSetId_idx" ON "standard_cost_versions"("parameterSetId");

-- CreateIndex
CREATE INDEX "standard_cost_versions_restoredFromId_idx" ON "standard_cost_versions"("restoredFromId");

-- CreateIndex
CREATE UNIQUE INDEX "standard_cost_versions_itemId_versionNo_key" ON "standard_cost_versions"("itemId", "versionNo");

-- CreateIndex
CREATE INDEX "standard_cost_lines_yarnItemId_idx" ON "standard_cost_lines"("yarnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "standard_cost_lines_versionId_lineNo_key" ON "standard_cost_lines"("versionId", "lineNo");

-- AddForeignKey
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_parameterSetId_fkey" FOREIGN KEY ("parameterSetId") REFERENCES "cost_parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_restoredFromId_fkey" FOREIGN KEY ("restoredFromId") REFERENCES "standard_cost_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_cost_lines" ADD CONSTRAINT "standard_cost_lines_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "standard_cost_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_cost_lines" ADD CONSTRAINT "standard_cost_lines_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tek yürürlükteki sürüm (ürün başına): iki eşzamanlı kayıttan biri P2002 → 409.
CREATE UNIQUE INDEX IF NOT EXISTS "standard_cost_versions_active_uq" ON "standard_cost_versions"("itemId") WHERE "status" = 'ACTIVE';

-- CHECK seddi (servis doğrulamasının ikinci hattı).
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_version_no_ck" CHECK ("versionNo" > 0);
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_amounts_ck" CHECK ("rawCostPerMTry" >= 0 AND "totalCostPerMTry" >= 0 AND ("finishedCostPerMTry" IS NULL OR "finishedCostPerMTry" >= 0) AND "warpKgPerM" >= 0 AND "weftKgPerM" >= 0 AND "loomMPerHour" > 0);
-- Durum ↔ damga çifti: SUPERSEDED ⇔ supersededAt dolu (iki yazar aynı tx'te; DB seddi).
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_superseded_ck" CHECK (("status" = 'SUPERSEDED') = ("supersededAt" IS NOT NULL));
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_hash_ck" CHECK ("inputHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "standard_cost_lines" ADD CONSTRAINT "standard_cost_lines_line_no_ck" CHECK ("lineNo" > 0);
