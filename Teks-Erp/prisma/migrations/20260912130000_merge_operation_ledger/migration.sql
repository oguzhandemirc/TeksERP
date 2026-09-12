-- =============================================================================
-- BİRLEŞTİRME DEFTERİ — master-data merge'in geri alınabilmesi için (defter ④)
-- =============================================================================
-- `mergedIntoId`/`mergedAt`/`mergedById` "birleşti" der ama NE TAŞINDIĞINI
-- söylemez; taşıma dökümü yalnız audit yükündeydi (tablo başına SAYI) ve audit 6
-- ayda arşivleniyor. Üç tablo: operasyon başlığı · kaynakların tombstone ÖNCESİ
-- hâli · taşınan/silinen/zenginleşen referans satırları.
--
-- Geri alma ileri satırları DEĞİŞTİRMEZ: başlığa `revertedAt` damgası yazılır.
-- GÜVENLİ: üç YENİ tablo + bir yeni enum tipi; mevcut satırlara dokunulmaz.
-- Eski birleştirmelerin defteri ÜRETİLMEZ (geçmiş uydurulmaz) — defter öncesi
-- birleştirme geri alınamaz ve servis bunu 409 ile söyler.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "MergeRefKind" AS ENUM ('MOVED', 'DELETED', 'FIELD_MERGED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "merge_operations" (
  "id"                UUID NOT NULL,
  "entity"            VARCHAR(40) NOT NULL,
  "survivorId"        UUID NOT NULL,
  "reason"            VARCHAR(500) NOT NULL,
  "conflictsResolved" INTEGER NOT NULL DEFAULT 0,
  "fieldPicks"        JSONB,
  "createdById"       UUID,
  "revertedAt"        TIMESTAMPTZ,
  "revertedById"      UUID,
  "revertReason"      VARCHAR(500),
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merge_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "merge_operations_entity_createdAt_idx"
  ON "merge_operations" ("entity", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "merge_operations_survivorId_idx"
  ON "merge_operations" ("survivorId");

CREATE TABLE IF NOT EXISTS "merge_operation_sources" (
  "id"             UUID NOT NULL,
  "operationId"    UUID NOT NULL,
  "sourceId"       UUID NOT NULL,
  "nameBefore"     VARCHAR(255) NOT NULL,
  "codeBefore"     VARCHAR(64),
  "isActiveBefore" BOOLEAN NOT NULL,
  "renamedTo"      VARCHAR(255),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merge_operation_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "merge_operation_sources_operationId_sourceId_key"
  ON "merge_operation_sources" ("operationId", "sourceId");

CREATE TABLE IF NOT EXISTS "merge_operation_refs" (
  "id"          UUID NOT NULL,
  "operationId" UUID NOT NULL,
  "sourceId"    UUID,
  "tableName"   VARCHAR(63) NOT NULL,
  "columnName"  VARCHAR(63) NOT NULL,
  "kind"        "MergeRefKind" NOT NULL,
  "count"       INTEGER NOT NULL,
  "rowIds"      UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "rowKeys"     JSONB,
  "rowData"     JSONB,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merge_operation_refs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "merge_operation_refs_operationId_idx"
  ON "merge_operation_refs" ("operationId");

DO $$ BEGIN
  ALTER TABLE "merge_operation_sources" ADD CONSTRAINT "merge_operation_sources_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "merge_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "merge_operation_refs" ADD CONSTRAINT "merge_operation_refs_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "merge_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
