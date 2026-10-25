-- K4P-SERT (2026-10-25) — sertifikalar + belge ekleri + müşteri lab spesifikasyonu
-- (docs/design/KALITE-4PUAN-PLAN.md §6.2, §3.4). ADDITIVE: yeni enum + üç yeni tablo + `lab_tests.customerId`
-- (nullable; mevcut satır NULL kalır, veri göçü yok).
-- İDEMPOTENT: enum/FK/CHECK `duplicate_object` yutulur, tablo/index/kolon `IF NOT EXISTS`.
-- `DropForeignKey` satırları (prisma diff gürültüsü: composite DEFERRABLE FK'lar) SİLİNDİ.

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "CertificateHolder" AS ENUM ('OWN', 'PARTNER'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AlterTable
ALTER TABLE "lab_tests" ADD COLUMN IF NOT EXISTS "customerId" UUID;

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_lab_specs" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "itemId" UUID,
    "testTypeId" UUID NOT NULL,
    "specMin" DECIMAL(12,3),
    "specMax" DECIMAL(12,3),
    "note" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "customer_lab_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "certificates" (
    "id" UUID NOT NULL,
    "holder" "CertificateHolder" NOT NULL,
    "partnerId" UUID,
    "standard" VARCHAR(64) NOT NULL,
    "certificateNo" VARCHAR(80) NOT NULL,
    "issuer" VARCHAR(120),
    "scope" VARCHAR(500),
    "issuedOn" DATE,
    "expiresOn" DATE NOT NULL,
    "note" VARCHAR(500),
    "renewsId" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(500),
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "certificate_files" (
    "id" UUID NOT NULL,
    "certificateId" UUID NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "certificate_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_lab_specs_itemId_idx" ON "customer_lab_specs"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_lab_specs_testTypeId_idx" ON "customer_lab_specs"("testTypeId");

-- CreateIndex
-- PARTIAL ikilisi = aktif (müşteri, COALESCE(ürün, sıfır), tür) tekilliği (FourPointRuleSet emsali;
-- drift bekçisi ifade index'ini göremez).
CREATE UNIQUE INDEX IF NOT EXISTS "customer_lab_specs_customer_uq" ON "customer_lab_specs"("customerId", "testTypeId")
  WHERE "isActive" = true AND "itemId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_lab_specs_customer_item_uq" ON "customer_lab_specs"("customerId", "itemId", "testTypeId")
  WHERE "isActive" = true AND "itemId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_renewsId_key" ON "certificates"("renewsId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_clientToken_key" ON "certificates"("clientToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificates_partnerId_idx" ON "certificates"("partnerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificates_expiresOn_id_idx" ON "certificates"("expiresOn", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "certificate_files_certificateId_sha256_key" ON "certificate_files"("certificateId", "sha256");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lab_tests_customerId_idx" ON "lab_tests"("customerId");

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_lab_specs" ADD CONSTRAINT "customer_lab_specs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_lab_specs" ADD CONSTRAINT "customer_lab_specs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_lab_specs" ADD CONSTRAINT "customer_lab_specs_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "lab_test_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_lab_specs" ADD CONSTRAINT "customer_lab_specs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_lab_specs" ADD CONSTRAINT "customer_lab_specs_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_renewsId_fkey" FOREIGN KEY ("renewsId") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "certificate_files" ADD CONSTRAINT "certificate_files_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "certificate_files" ADD CONSTRAINT "certificate_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: OWN ⇔ iş ortağı yok (tek FK; XOR'lu çift bağ yok).
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_holder_ck"
  CHECK (("holder" = 'OWN') = ("partnerId" IS NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: iptal damgası ⇔ gerekçe (≥ 3 karakter) ve iptal eden.
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_ck"
  CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL)
         AND ("revokedAt" IS NULL OR ("revokedById" IS NOT NULL AND char_length(btrim("revokeReason")) >= 3)));
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: düzenleme günü geçerlilik sonundan sonra olamaz; sertifika kendini yenileyemez.
DO $t$ BEGIN ALTER TABLE "certificates" ADD CONSTRAINT "certificates_dates_ck"
  CHECK (("issuedOn" IS NULL OR "issuedOn" <= "expiresOn") AND ("renewsId" IS NULL OR "renewsId" <> "id"));
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: 5 MB tavanı + beyan edilen boy = gerçek bayt sayısı; tür yalnız PDF/JPEG/PNG.
DO $t$ BEGIN ALTER TABLE "certificate_files" ADD CONSTRAINT "certificate_files_size_ck"
  CHECK ("sizeBytes" BETWEEN 1 AND 5242880 AND octet_length("content") = "sizeBytes");
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN ALTER TABLE "certificate_files" ADD CONSTRAINT "certificate_files_mime_ck"
  CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png') AND char_length("sha256") = 64);
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: spesifikasyon en az bir sınır taşır; alt ≤ üst.
DO $t$ BEGIN ALTER TABLE "customer_lab_specs" ADD CONSTRAINT "customer_lab_specs_bounds_ck"
  CHECK (("specMin" IS NOT NULL OR "specMax" IS NOT NULL) AND ("specMin" IS NULL OR "specMax" IS NULL OR "specMin" <= "specMax"));
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
