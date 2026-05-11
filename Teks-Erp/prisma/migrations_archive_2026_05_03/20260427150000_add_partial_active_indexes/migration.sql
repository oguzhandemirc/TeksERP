-- =============================================================================
-- Partial indexes — soft-delete edilmemiş kayıtlar için hızlı liste sorguları
-- =============================================================================
-- Item ve Customer büyüme potansiyeli olan tablolar. Hemen her liste sorgusu
-- WHERE "isActive" = true ile filtrelenir; partial index pasif kayıtları
-- index'e dahil etmez ve ilgili sütunlarla composite çalışır.
--
-- Prisma @@index direktifi WHERE clause desteklemediği için raw SQL gerekli.
-- Idempotent (IF NOT EXISTS) — tekrar uygulanması güvenli.
-- =============================================================================

CREATE INDEX IF NOT EXISTS "items_active_type_name_idx"
  ON "items" ("itemType", "name")
  WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS "customers_active_type_name_idx"
  ON "customers" ("type", "name")
  WHERE "isActive" = true;
