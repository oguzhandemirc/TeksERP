-- =============================================================================
-- GELEN BELGE TASLAĞI ŞEMASI (Gülkesim OCR, D2 — TASARIM-KARARI-2026-10-28 §4; 2026-10-29)
-- =============================================================================
-- ADDITIVE: altı yeni enum + beş yeni tablo (customer_delivery_notes · customer_delivery_note_lines ·
-- document_scans · sender_templates · delivery_note_aliases) + index/FK + CHECK + partial unique.
-- Mevcut tabloya kolon EKLENMEZ (`rolls`a kolon yok; `RollEntrySource`a değer yok). Veri göçü yok.
-- İDEMPOTENT: enum/FK/CHECK `duplicate_object` yutulur, tablo/index `IF NOT EXISTS`.
-- `DropForeignKey` satırları (prisma diff gürültüsü: composite DEFERRABLE FK'lar) SİLİNDİ.
-- number_series `GB` satırı MIGRATION'DA YAZILMAZ: katalog tohumu (`number-series-catalog.ts`)
-- boot'ta `reconcileNumberSeries` ile doğar (reçete § Yeni numara serisi).
-- =============================================================================

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "DeliveryNoteStatus" AS ENUM ('DRAFT', 'APPROVING', 'APPROVED', 'PARTIAL', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "DeliveryNoteSourceKind" AS ENUM ('OCR', 'MANUAL', 'IMPORT'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "DeliveryNoteLineKind" AS ENUM ('TOP', 'ARABA'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "DeliveryNoteLineStatus" AS ENUM ('PENDING', 'ENTERING', 'ENTERED', 'FAILED', 'SKIPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'READING', 'READ', 'READ_FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "DeliveryNoteAliasScope" AS ENUM ('SENDER', 'ITEM', 'COLOR', 'PROCESS'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_delivery_notes" (
    "id" UUID NOT NULL,
    "noteNo" VARCHAR(32) NOT NULL,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceKind" "DeliveryNoteSourceKind" NOT NULL,
    "ownerCustomerId" UUID,
    "senderCustomerId" UUID,
    "senderText" VARCHAR(160),
    "senderDocNo" VARCHAR(64),
    "senderDocDate" DATE,
    "customerBatchNo" VARCHAR(64),
    "processText" VARCHAR(120),
    "templateId" UUID,
    "templateScore" DECIMAL(5,4),
    "pageCount" SMALLINT,
    "declaredTopCount" SMALLINT,
    "totalsDeclared" JSONB,
    "varianceReason" VARCHAR(500),
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "approvedAt" TIMESTAMPTZ,
    "approvedById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(500),
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "customer_delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_delivery_note_lines" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "lineNo" SMALLINT NOT NULL,
    "blockNo" SMALLINT NOT NULL DEFAULT 1,
    "lineKind" "DeliveryNoteLineKind" NOT NULL DEFAULT 'TOP',
    "senderRollNo" VARCHAR(64),
    "meters" DECIMAL(12,3) NOT NULL,
    "weightKg" DECIMAL(12,3),
    "widthCm" DECIMAL(8,2),
    "itemText" VARCHAR(160),
    "itemId" UUID,
    "colorText" VARCHAR(120),
    "colorId" UUID,
    "processText" VARCHAR(120),
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "sourceRects" JSONB,
    "ocrRaw" JSONB,
    "status" "DeliveryNoteLineStatus" NOT NULL DEFAULT 'PENDING',
    "failReason" VARCHAR(500),
    "rollId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_scans" (
    "id" UUID NOT NULL,
    "noteId" UUID,
    "pageNo" SMALLINT NOT NULL DEFAULT 1,
    "regionNo" SMALLINT,
    "sha256" VARCHAR(64) NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "barcodeText" VARCHAR(120),
    "status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "ocrEngine" VARCHAR(32),
    "ocrVersion" VARCHAR(32),
    "ocrDurationMs" INTEGER,
    "ocrResult" JSONB,
    "capturedById" UUID,
    "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sender_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template" JSONB NOT NULL,
    "senderCustomerId" UUID,
    "defaultOwnerCustomerId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sender_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "delivery_note_aliases" (
    "id" UUID NOT NULL,
    "scope" "DeliveryNoteAliasScope" NOT NULL,
    "senderCustomerId" UUID,
    "rawFold" VARCHAR(160) NOT NULL,
    "targetId" UUID NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_note_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_notes_noteNo_key" ON "customer_delivery_notes"("noteNo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_notes_clientToken_key" ON "customer_delivery_notes"("clientToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_delivery_notes_ownerCustomerId_idx" ON "customer_delivery_notes"("ownerCustomerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_delivery_notes_senderCustomerId_idx" ON "customer_delivery_notes"("senderCustomerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_delivery_notes_templateId_idx" ON "customer_delivery_notes"("templateId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_delivery_notes_status_createdAt_idx" ON "customer_delivery_notes"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_note_lines_rollId_key" ON "customer_delivery_note_lines"("rollId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_delivery_note_lines_itemId_idx" ON "customer_delivery_note_lines"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_delivery_note_lines_colorId_idx" ON "customer_delivery_note_lines"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_note_lines_noteId_lineNo_key" ON "customer_delivery_note_lines"("noteId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_scans_sha256_key" ON "document_scans"("sha256");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "document_scans_noteId_idx" ON "document_scans"("noteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "document_scans_status_createdAt_idx" ON "document_scans"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sender_templates_code_key" ON "sender_templates"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sender_templates_senderCustomerId_idx" ON "sender_templates"("senderCustomerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sender_templates_defaultOwnerCustomerId_idx" ON "sender_templates"("defaultOwnerCustomerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "delivery_note_aliases_targetId_idx" ON "delivery_note_aliases"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_note_aliases_scope_senderCustomerId_rawFold_key" ON "delivery_note_aliases"("scope", "senderCustomerId", "rawFold");

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_senderCustomerId_fkey" FOREIGN KEY ("senderCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sender_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_note_lines" ADD CONSTRAINT "customer_delivery_note_lines_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "customer_delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_note_lines" ADD CONSTRAINT "customer_delivery_note_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_note_lines" ADD CONSTRAINT "customer_delivery_note_lines_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "customer_delivery_note_lines" ADD CONSTRAINT "customer_delivery_note_lines_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "document_scans" ADD CONSTRAINT "document_scans_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "customer_delivery_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "document_scans" ADD CONSTRAINT "document_scans_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "sender_templates" ADD CONSTRAINT "sender_templates_senderCustomerId_fkey" FOREIGN KEY ("senderCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "sender_templates" ADD CONSTRAINT "sender_templates_defaultOwnerCustomerId_fkey" FOREIGN KEY ("defaultOwnerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AddForeignKey
DO $t$ BEGIN ALTER TABLE "delivery_note_aliases" ADD CONSTRAINT "delivery_note_aliases_senderCustomerId_fkey" FOREIGN KEY ("senderCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: tarama 5 MB tavanı + beyan edilen boy = gerçek bayt sayısı (certificate_files emsali).
DO $t$ BEGIN ALTER TABLE "document_scans" ADD CONSTRAINT "document_scans_size_ck"
  CHECK ("sizeBytes" BETWEEN 1 AND 5242880 AND octet_length("content") = "sizeBytes");
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: tür yalnız JPEG/PNG/PDF (sihirli bayttan tespit edilen küme) + sha256 hex uzunluğu; sayfa/bölge ≥ 1.
DO $t$ BEGIN ALTER TABLE "document_scans" ADD CONSTRAINT "document_scans_mime_ck"
  CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'application/pdf') AND char_length("sha256") = 64
         AND "pageNo" >= 1 AND ("regionNo" IS NULL OR "regionNo" >= 1) AND "attempts" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: satır metrajı pozitif; kilo/en verildiyse pozitif; güven 0..1; satır/blok numarası ≥ 1.
DO $t$ BEGIN ALTER TABLE "customer_delivery_note_lines" ADD CONSTRAINT "customer_delivery_note_lines_meters_ck"
  CHECK ("meters" > 0 AND ("weightKg" IS NULL OR "weightKg" > 0) AND ("widthCm" IS NULL OR "widthCm" > 0)
         AND "confidence" BETWEEN 0 AND 1 AND "lineNo" >= 1 AND "blockNo" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CHECK: onay damgası ⇔ onaylayan; iptal damgası ⇔ iptal eden + gerekçe (≥ 3 karakter); sayfa/adet ≥ 1.
DO $t$ BEGIN ALTER TABLE "customer_delivery_notes" ADD CONSTRAINT "customer_delivery_notes_stamps_ck"
  CHECK (("approvedAt" IS NULL) = ("approvedById" IS NULL)
         AND ("cancelledAt" IS NULL) = ("cancelledById" IS NULL)
         AND ("cancelledAt" IS NULL OR char_length(btrim(coalesce("cancelReason", ''))) >= 3)
         AND ("pageCount" IS NULL OR "pageCount" >= 1) AND ("declaredTopCount" IS NULL OR "declaredTopCount" >= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- PARTIAL UNIQUE: aynı sahibe aynı gönderen belge numarası iptal dışı tek taslak/belge (mükerrer irsaliye seddi).
-- Yeni tablo — canlı veri yok, yumuşak kapı gerekmez.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_notes_owner_sender_doc_uq"
  ON "customer_delivery_notes"("ownerCustomerId", "senderDocNo")
  WHERE "ownerCustomerId" IS NOT NULL AND "senderDocNo" IS NOT NULL AND "status" <> 'CANCELLED';
