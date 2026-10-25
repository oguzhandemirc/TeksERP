-- K4P-LAB (2026-10-25) — lab test kataloğu + lab testi + sonuç satırı (docs/design/KALITE-4PUAN-PLAN.md §6.1, §3.4).
-- ADDITIVE: yalnız yeni enum + yeni tablo; mevcut tabloya kolon/kısıt eklenmez, veri göçü yok.
-- İDEMPOTENT: enum/FK/CHECK `duplicate_object` yutulur, tablo/index `IF NOT EXISTS` — dosya iki kez koşabilir.
-- `DropForeignKey` satırları (prisma diff gürültüsü: composite DEFERRABLE FK'lar) SİLİNDİ.

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "LabResultKind" AS ENUM ('NUMERIC', 'SCALE', 'PASS_FAIL'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "LabTestStatus" AS ENUM ('DRAFT', 'APPROVED', 'VOIDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "LabVerdict" AS ENUM ('PASS', 'FAIL'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "LabVerdictSource" AS ENUM ('AUTO', 'MANUAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "lab_test_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "method" VARCHAR(64),
    "resultKind" "LabResultKind" NOT NULL,
    "scaleMax" SMALLINT,
    "unit" VARCHAR(16),
    "specMin" DECIMAL(12,3),
    "specMax" DECIMAL(12,3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "lab_test_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lab_tests" (
    "id" UUID NOT NULL,
    "testNo" VARCHAR(40) NOT NULL,
    "rollId" UUID,
    "batchId" UUID,
    "itemId" UUID NOT NULL,
    "sampleCode" VARCHAR(64),
    "labName" VARCHAR(120),
    "testedOn" DATE NOT NULL,
    "note" VARCHAR(500),
    "status" "LabTestStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMPTZ,
    "approvedById" UUID,
    "voidedAt" TIMESTAMPTZ,
    "voidedById" UUID,
    "voidReason" VARCHAR(500),
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lab_test_results" (
    "id" UUID NOT NULL,
    "labTestId" UUID NOT NULL,
    "testTypeId" UUID NOT NULL,
    "resultKind" "LabResultKind" NOT NULL,
    "scaleMax" SMALLINT,
    "value" DECIMAL(12,3),
    "unit" VARCHAR(16),
    "specMin" DECIMAL(12,3),
    "specMax" DECIMAL(12,3),
    "verdict" "LabVerdict" NOT NULL,
    "verdictSource" "LabVerdictSource" NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lab_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lab_test_types_code_key" ON "lab_test_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lab_tests_testNo_key" ON "lab_tests"("testNo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lab_tests_clientToken_key" ON "lab_tests"("clientToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lab_tests_rollId_idx" ON "lab_tests"("rollId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lab_tests_batchId_idx" ON "lab_tests"("batchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lab_tests_itemId_idx" ON "lab_tests"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lab_tests_testedOn_id_idx" ON "lab_tests"("testedOn", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lab_test_results_testTypeId_idx" ON "lab_test_results"("testTypeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lab_test_results_labTestId_testTypeId_key" ON "lab_test_results"("labTestId", "testTypeId");

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_test_types" ADD CONSTRAINT "lab_test_types_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_test_types" ADD CONSTRAINT "lab_test_types_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_test_results" ADD CONSTRAINT "lab_test_results_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "lab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- AddForeignKey
DO $f$ BEGIN ALTER TABLE "lab_test_results" ADD CONSTRAINT "lab_test_results_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "lab_test_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

-- ── Elle: CHECK seddi (Prisma ifade edemez; envanter `test_db_invariants`, bekçi `test_lab_test`) ──
DO $c$ BEGIN
-- Skala tavanı yalnız SCALE türünde ve zorunlu; PASS_FAIL türünde sınır/birim yok; sınır aralığı düzgün.
ALTER TABLE "lab_test_types" ADD CONSTRAINT "lab_test_types_kind_ck"
  CHECK ((("resultKind" = 'SCALE') = ("scaleMax" IS NOT NULL))
         AND ("scaleMax" IS NULL OR "scaleMax" BETWEEN 2 AND 10)
         AND ("resultKind" <> 'PASS_FAIL' OR ("specMin" IS NULL AND "specMax" IS NULL AND "unit" IS NULL))
         AND ("specMin" IS NULL OR "specMax" IS NULL OR "specMin" <= "specMax"));
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

DO $c$ BEGIN
-- Test en az bir nesneye (top ya da parti) bağlıdır.
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_subject_ck"
  CHECK (num_nonnulls("rollId", "batchId") >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

DO $c$ BEGIN
-- Onay damgası: APPROVED onaysız olamaz; DRAFT hiç damga taşımaz (iptal edilen onaylı test
-- approvedAt'ini KORUR — "ne oldu" silinmez; bu yüzden ⇔ değil iki yönlü ⇒).
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_approved_ck"
  CHECK (("status" <> 'APPROVED' OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL))
         AND ("status" <> 'DRAFT' OR ("approvedAt" IS NULL AND "voidedAt" IS NULL))
         AND (("approvedAt" IS NULL) = ("approvedById" IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

DO $c$ BEGIN
-- İptal: VOIDED ⇔ voidedAt; gerekçe en az 3 anlamlı karakter + iptal eden kişi.
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_voided_ck"
  CHECK ((("status" = 'VOIDED') = ("voidedAt" IS NOT NULL))
         AND ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND char_length(btrim(coalesce("voidReason", ''))) >= 3)));
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

DO $c$ BEGIN
-- Sonuç biçimi: SCALE 1..scaleMax arası 0,5 adım; NUMERIC değer zorunlu; PASS_FAIL değersiz;
-- AUTO hüküm yalnız sınır snapshot'ı varken.
ALTER TABLE "lab_test_results" ADD CONSTRAINT "lab_test_results_value_ck"
  CHECK ((("resultKind" = 'SCALE') = ("scaleMax" IS NOT NULL))
         AND ("resultKind" <> 'SCALE' OR ("value" IS NOT NULL AND "value" * 2 = trunc("value" * 2)
                                           AND "value" >= 1 AND "value" <= "scaleMax"))
         AND ("resultKind" <> 'NUMERIC' OR "value" IS NOT NULL)
         AND ("resultKind" <> 'PASS_FAIL' OR ("value" IS NULL AND "specMin" IS NULL AND "specMax" IS NULL))
         AND ("verdictSource" <> 'AUTO' OR "specMin" IS NOT NULL OR "specMax" IS NOT NULL)
         AND ("specMin" IS NULL OR "specMax" IS NULL OR "specMin" <= "specMax"));
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;
