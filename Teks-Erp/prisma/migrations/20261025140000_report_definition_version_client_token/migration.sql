-- Kayıtlı raporlar (R1-KAYIT, K-KAYIT): yeni sürüm ucu idempotent olur — `clientToken @unique`.
-- Kolon nullable (eski sürüm satırları ve v1 sürüm tanımın token'ıyla doğar). İdempotent: IF NOT EXISTS.

-- AlterTable
ALTER TABLE "report_definition_versions" ADD COLUMN IF NOT EXISTS "clientToken" UUID;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_definition_versions_clientToken_key" ON "report_definition_versions"("clientToken");
