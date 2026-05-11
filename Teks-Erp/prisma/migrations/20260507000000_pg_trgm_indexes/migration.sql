-- =============================================================================
-- pg_trgm GIN Index'leri — ILIKE/contains arama hızlandırması
-- =============================================================================
-- '%abc%' tipindeki LIKE/ILIKE sorguları normal B-tree index kullanamaz —
-- full-table scan yapar. pg_trgm extension'ı ile trigram tabanlı GIN index
-- bu aramaları büyük tablolarda 10-100x hızlandırır.
--
-- Bu migration'ı CONCURRENTLY ile psql üzerinden uygula:
--   psql "$DATABASE_URL" -f migration.sql
--   npx prisma migrate resolve --applied 20260507000000_pg_trgm_indexes
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Orders: orderNumber araması (sipariş listesi search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_orderNumber_trgm_idx"
  ON "orders" USING gin ("orderNumber" gin_trgm_ops);

-- Customers: name araması (müşteri seçimi, autocomplete)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customers_name_trgm_idx"
  ON "customers" USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "customers_code_trgm_idx"
  ON "customers" USING gin (code gin_trgm_ops);

-- Items: name araması (ürün arama)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "items_name_trgm_idx"
  ON "items" USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "items_code_trgm_idx"
  ON "items" USING gin (code gin_trgm_ops);

-- Shipments: shipmentNumber + plateNumber araması
CREATE INDEX CONCURRENTLY IF NOT EXISTS "shipments_shipmentNumber_trgm_idx"
  ON "shipments" USING gin ("shipmentNumber" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "shipments_plateNumber_trgm_idx"
  ON "shipments" USING gin ("plateNumber" gin_trgm_ops)
  WHERE "plateNumber" IS NOT NULL;

-- Rolls: barcode araması (top barkod tarama)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "rolls_barcode_trgm_idx"
  ON "rolls" USING gin (barcode gin_trgm_ops);

-- WorkOrders: batchNumber araması (parti no)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "work_orders_batchNumber_trgm_idx"
  ON "work_orders" USING gin ("batchNumber" gin_trgm_ops);
