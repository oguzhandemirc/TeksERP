-- =============================================================================
-- SystemLog'a event kategorisi ekle (AUTH/SYSTEM olayları için).
-- =============================================================================
-- DOMAIN = mevcut CUD audit (Activity Page)
-- AUTH   = login_success/login_failed (Sistem Kayıtları)
-- SYSTEM = startup/error (Sistem Kayıtları)
--
-- DEFAULT 'DOMAIN' sayesinde mevcut satırlar otomatik DOMAIN olur; Activity
-- Page bozulmaz. ipAddress AUTH/SYSTEM event'lerinde dolar, DOMAIN'de NULL.
--
-- Composite index `(category, createdAt DESC)` Sistem Kayıtları sayfasının
-- "kategori filtresi + son N kayıt" sorgusunu tek scan ile karşılar.
-- =============================================================================

ALTER TABLE "system_logs"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'DOMAIN',
  ADD COLUMN "ipAddress" TEXT;

ALTER TABLE "system_log_archives"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'DOMAIN',
  ADD COLUMN "ipAddress" TEXT;

CREATE INDEX "system_logs_category_createdAt_idx"
  ON "system_logs" ("category", "createdAt" DESC);

CREATE INDEX "system_log_archives_category_createdAt_idx"
  ON "system_log_archives" ("category", "createdAt" DESC);
