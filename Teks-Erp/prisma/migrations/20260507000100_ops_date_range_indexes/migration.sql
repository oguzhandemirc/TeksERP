-- =============================================================================
-- Operasyon listeleme tarih aralığı index'leri
-- =============================================================================
-- Liste sayfaları (Orders, Shipments) cursor pagination ile çalışır ve "son N
-- gün" tarih aralığı varsayılanı uygular. Range query (`createdAt >= $1`)
-- composite index olmadan büyük tabloda seq scan yapar.
--
-- Roll ve WorkOrder zaten `[status, createdAt]`'a sahip — bu migration sadece
-- eksik kalan iki tabloyu doldurur.
--
-- Canlıya uygulama:
--   psql "$DATABASE_URL" -f migration.sql
--   npx prisma migrate resolve --applied 20260507000100_ops_date_range_indexes
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_status_createdAt_idx"
  ON "orders" ("status", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_deadline_idx"
  ON "orders" ("deadline");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "shipments_status_createdAt_idx"
  ON "shipments" ("status", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "shipments_shippedAt_idx"
  ON "shipments" ("shippedAt");
