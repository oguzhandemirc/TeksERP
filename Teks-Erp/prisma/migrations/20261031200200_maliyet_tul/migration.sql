-- =============================================================================
-- SEYİTOĞLU MİG-2b — TÜL MALİYETİ: ATKI ÜCRETİ + PROSES SATIRI + VARYANT SÜRÜMÜ (SY-D1) — 2026-10-31
-- =============================================================================
-- EKLEMELİ + iki metadata değişikliği:
--  · `standard_cost_versions.loomMPerHour` DROP NOT NULL — katalog işlemi, tablo yeniden
--    yazılmaz; mevcut satırlar dolu kalır (atkı ücreti yönteminde hız bilinmiyorsa NULL, 0 değil).
--  · `standard_cost_versions_active_uq` yeniden kurulur: (itemId) → (itemId, COALESCE(recipeId,
--    sıfır-UUID)). Bugünkü tüm satırlarda recipeId NULL → anahtar (itemId, sıfır) = ESKİ tekillik
--    aynen (çift aktif sürüm yine P2002 → 409). Drop + create AYNI dosyada (tek tx).
-- Toplu UPDATE/DELETE YOK. Tasarım §5.4, §8.4, §16.2 madde 3.
-- =============================================================================

-- AlterTable
ALTER TABLE "cost_parameter_sets" ADD COLUMN     "defaultLoomPickCurrency" "Currency",
ADD COLUMN     "defaultLoomPickRate" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "cost_structures" ADD COLUMN     "loomPickCurrency" "Currency",
ADD COLUMN     "loomPickRate" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "standard_cost_versions" ADD COLUMN     "recipeId" UUID,
ALTER COLUMN "loomMPerHour" DROP NOT NULL;

-- CreateTable
CREATE TABLE "cost_structure_processes" (
    "id" UUID NOT NULL,
    "costStructureId" UUID NOT NULL,
    "rateCode" VARCHAR(32) NOT NULL,
    "sortOrder" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cost_structure_processes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_structure_processes_costStructureId_rateCode_key" ON "cost_structure_processes"("costStructureId", "rateCode");

-- CreateIndex
CREATE UNIQUE INDEX "cost_structure_processes_costStructureId_sortOrder_key" ON "cost_structure_processes"("costStructureId", "sortOrder");

-- CreateIndex
CREATE INDEX "standard_cost_versions_recipeId_idx" ON "standard_cost_versions"("recipeId");

-- AddForeignKey
ALTER TABLE "cost_structure_processes" ADD CONSTRAINT "cost_structure_processes_costStructureId_fkey" FOREIGN KEY ("costStructureId") REFERENCES "cost_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- DB SEDLERİ — atkı ücreti çifti: ikisi birlikte dolu ya da boş; ücret ≥ 0.
-- =============================================================================
ALTER TABLE "cost_structures" ADD CONSTRAINT "cost_structures_loom_pick_pair_ck" CHECK (
  ("loomPickRate" IS NULL) = ("loomPickCurrency" IS NULL)
  AND ("loomPickRate" IS NULL OR "loomPickRate" >= 0)
);
ALTER TABLE "cost_parameter_sets" ADD CONSTRAINT "cost_parameter_sets_loom_pick_pair_ck" CHECK (
  ("defaultLoomPickRate" IS NULL) = ("defaultLoomPickCurrency" IS NULL)
  AND ("defaultLoomPickRate" IS NULL OR "defaultLoomPickRate" >= 0)
);
ALTER TABLE "cost_structure_processes" ADD CONSTRAINT "cost_structure_processes_sort_ck" CHECK ("sortOrder" >= 0);

-- =============================================================================
-- ŞEMA-DIŞI AKTİF SÜRÜM TEKİLLİĞİ — kumaş × varyant başına tek ACTIVE (NULL varyant = desen geneli)
-- =============================================================================
DROP INDEX IF EXISTS "standard_cost_versions_active_uq";
CREATE UNIQUE INDEX "standard_cost_versions_active_uq" ON "standard_cost_versions"
  ("itemId", COALESCE("recipeId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "status" = 'ACTIVE';
