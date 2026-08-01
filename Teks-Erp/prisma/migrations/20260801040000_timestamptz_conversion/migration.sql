-- ============================================================================
-- 20260801040000_timestamptz_conversion
-- TÜM tarih kolonlarını `timestamp without time zone` → `timestamptz`
-- ============================================================================
--
-- KÖK SORUN
-- ---------
-- Veritabanındaki 183 tarih kolonu saat dilimi bilgisi TAŞIMIYORDU. Böyle bir
-- kolon yalnızca "duvardaki saat"i saklar; hangi saat diliminde okunacağı
-- kolonun kendisinde yazmaz. Bu yüzden doğruluk tamamen "herkes UTC yazsın"
-- disiplinine bağlıydı — yapısal bir garanti değil, bir gelenekti.
--
-- 2026-08-01 gecesi bu gelenek gerçekten kırıldı: üretim kodundaki ham SQL
-- yazımları `roll_movements."exitedAt"` kolonuna çıplak `NOW()` (= oturumun
-- saat dilimi, Europe/Istanbul) yazarken Prisma AYNI kolona UTC yazıyordu.
-- Sonuç: tek kolonda iki farklı saat ve `AVG("exitedAt" - "enteredAt")` ile
-- hesaplanan istasyon sürelerinde +10800 sn (3 saat) sessiz şişme. Hata yok,
-- log yok, uyarı yok. 13 yazma/okuma noktası düzeltildi ve
-- `scripts/test_raw_sql_hygiene.ts` bekçisi eklendi — ama o bir DİSİPLİN
-- çözümüydü: yeni bir geliştirici ham SQL yazdığı gün aynı hata geri döner.
--
-- KÖKTEN ÇÖZÜM
-- ------------
-- `timestamptz` kolon MUTLAK ANI saklar (içeride UTC epoch). Artık kim yazarsa
-- yazsın — Prisma, `NOW()`, `CURRENT_TIMESTAMP`, kolon DEFAULT'u — hepsi aynı
-- doğru anı üretir; oturumun saat dilimi yalnızca GÖSTERİMİ etkiler. Hata
-- sınıfı yapısal olarak ortadan kalkar; artık bir kurala uymak gerekmiyor.
--
-- NEDEN TAM ŞİMDİ (kapanan pencere)
-- ---------------------------------
-- Fabrikada henüz GERÇEK ÜRETİM VERİSİ YOK — yalnız tanımlar ve siparişler var.
-- Tablolar boşken her ALTER anlıktır. Veri biriktikten sonra bu ALTER'ların her
-- biri TAM TABLO YENİDEN YAZIMI + dışlayıcı (ACCESS EXCLUSIVE) kilit demektir:
-- milyon satırlık `roll_movements` üzerinde vardiyayı durdurmak. Bu pencere
-- fabrikadan ilk gerçek top girdiği gün KAPANIYOR.
--
-- ⚠️ EN TEHLİKELİ AYRINTI — `USING` YAN TÜMCESİ ⚠️
-- ------------------------------------------------
-- Prisma'nın üreteceği çıplak
--     ALTER TABLE x ALTER COLUMN c SET DATA TYPE timestamptz;
-- YANLIŞTIR. `USING` olmadan PostgreSQL mevcut değerleri OTURUMUN saat
-- diliminde yorumlar — Europe/Istanbul'da bu, kayıtlı her anı 3 saat geriye
-- kaydırır. Yani bu gece tek bir kolonda düzelttiğimiz hatayı TÜM veritabanına
-- yayardı. Doğrusu:
--     ALTER TABLE x ALTER COLUMN c TYPE timestamptz USING c AT TIME ZONE 'UTC';
-- Gerekçe: mevcut değerleri Prisma UTC olarak yazdı; dolayısıyla dönüşümde
-- "bu değer UTC'dir" diye BEYAN etmemiz gerekir. `c AT TIME ZONE 'UTC'` tam
-- olarak bunu söyler ve epoch değeri DEĞİŞMEZ (doğrulama: dönüşüm öncesi/sonrası
-- `EXTRACT(EPOCH FROM ...)` karşılaştırması birebir aynı olmalı).
--
-- KAPSAM
-- ------
-- Liste `information_schema.columns`'tan deterministik üretildi:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema='public' AND data_type='timestamp without time zone'
--    ORDER BY table_name, column_name;
-- 80 tablo, 183 kolon. Kapsam dışı bırakılanlar:
--   • `_prisma_migrations` — Prisma'nın kendi defteri, zaten timestamptz.
--   • `endpoint_latency_daily."day"` — `date` tipi (saat taşımayan takvim günü),
--     dönüştürülmemeli.
--   • Halihazırda timestamptz olan 9 kolon (kursun_bypass_assignments ×5,
--     label_templates/peripheral_devices/users."deletedAt",
--     swatch_stock_reductions."createdAt").
-- Şema tarafı `prisma/schema.prisma` içinde tüm `DateTime` alanlarına
-- `@db.Timestamptz` eklenerek eşitlendi (183 alan).
--
-- NOTLAR
-- ------
-- • `SET statement_timeout = 0;` — app DB'sinde 50 sn'lik `statement_timeout`
--   aktif. Boş tabloda sorun çıkmaz, ama bu dosya ileride DOLU bir kopyada
--   (restore/staging) koşarsa yarıda kesilmemeli. Ev stili: uzun DDL → timeout 0.
-- • Kolonlara bağlı index'ler ve CHECK constraint'ler ALTER sırasında
--   PostgreSQL tarafından otomatik yeniden kurulur; partial index predicate'leri
--   (`WHERE "exitedAt" IS NULL` vb.) korunur — dönüşüm sonrası
--   `scripts/test_db_invariants.ts` ile doğrulanır.
-- • Geri alma: aynı liste `... TYPE timestamp USING c AT TIME ZONE 'UTC'` ile
--   ters çevrilir (yine epoch korunur). Yedekten restore gerekmez.
--
-- Elle yazılmıştır — `prisma migrate dev` KOŞULMADI: `sacks`/`swatches`
-- DEFERRABLE composite FK'ları datamodel'de temsil edilemediği için diff onları
-- DROP etmek ister. Uygulama: git add → `prisma db execute` → `migrate resolve
-- --applied` → doğrula.
-- ============================================================================

SET statement_timeout = 0;

-- batches (2)
ALTER TABLE "batches" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "batches" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- colors (2)
ALTER TABLE "colors" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "colors" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- customer_branches (2)
ALTER TABLE "customer_branches" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "customer_branches" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- customer_color_aliases (2)
ALTER TABLE "customer_color_aliases" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "customer_color_aliases" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- customer_item_aliases (2)
ALTER TABLE "customer_item_aliases" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "customer_item_aliases" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- customer_standalone_labels (1)
ALTER TABLE "customer_standalone_labels" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- customer_template_routes (2)
ALTER TABLE "customer_template_routes" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "customer_template_routes" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- customers (2)
ALTER TABLE "customers" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "customers" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- defect_types (2)
ALTER TABLE "defect_types" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "defect_types" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- device_peripherals (1)
ALTER TABLE "device_peripherals" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- devices (3)
ALTER TABLE "devices" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "devices" ALTER COLUMN "lastSeenAt" TYPE timestamptz USING "lastSeenAt" AT TIME ZONE 'UTC';
ALTER TABLE "devices" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- direct_shipments (3)
ALTER TABLE "direct_shipments" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "direct_shipments" ALTER COLUMN "shippedAt" TYPE timestamptz USING "shippedAt" AT TIME ZONE 'UTC';
ALTER TABLE "direct_shipments" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- document_profiles (2)
ALTER TABLE "document_profiles" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "document_profiles" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- endpoint_latency_daily (2)
ALTER TABLE "endpoint_latency_daily" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "endpoint_latency_daily" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- fabric_properties (2)
ALTER TABLE "fabric_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "fabric_properties" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- free_documents (2)
ALTER TABLE "free_documents" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "free_documents" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- item_allowed_colors (1)
ALTER TABLE "item_allowed_colors" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- item_allowed_properties (1)
ALTER TABLE "item_allowed_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- items (2)
ALTER TABLE "items" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "items" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- kartela_dispatch_items (1)
ALTER TABLE "kartela_dispatch_items" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- kartela_dispatches (4)
ALTER TABLE "kartela_dispatches" ALTER COLUMN "cancelledAt" TYPE timestamptz USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "kartela_dispatches" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "kartela_dispatches" ALTER COLUMN "dispatchedAt" TYPE timestamptz USING "dispatchedAt" AT TIME ZONE 'UTC';
ALTER TABLE "kartela_dispatches" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- kartela_receipt_items (1)
ALTER TABLE "kartela_receipt_items" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- kartela_receipts (4)
ALTER TABLE "kartela_receipts" ALTER COLUMN "cancelledAt" TYPE timestamptz USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "kartela_receipts" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "kartela_receipts" ALTER COLUMN "receivedAt" TYPE timestamptz USING "receivedAt" AT TIME ZONE 'UTC';
ALTER TABLE "kartela_receipts" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- label_context_defaults (2)
ALTER TABLE "label_context_defaults" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "label_context_defaults" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- label_template_variants (2)
ALTER TABLE "label_template_variants" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "label_template_variants" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- label_templates (2)
ALTER TABLE "label_templates" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "label_templates" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- machines (2)
ALTER TABLE "machines" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "machines" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- manifests (3)
ALTER TABLE "manifests" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "manifests" ALTER COLUMN "printedAt" TYPE timestamptz USING "printedAt" AT TIME ZONE 'UTC';
ALTER TABLE "manifests" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- order_line_required_properties (1)
ALTER TABLE "order_line_required_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- order_lines (2)
ALTER TABLE "order_lines" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "order_lines" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- orders (5)
ALTER TABLE "orders" ALTER COLUMN "completedAt" TYPE timestamptz USING "completedAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "deadline" TYPE timestamptz USING "deadline" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "orderDate" TYPE timestamptz USING "orderDate" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- peripheral_devices (3)
ALTER TABLE "peripheral_devices" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "peripheral_devices" ALTER COLUMN "lastSeenAt" TYPE timestamptz USING "lastSeenAt" AT TIME ZONE 'UTC';
ALTER TABLE "peripheral_devices" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- peripheral_template_routes (2)
ALTER TABLE "peripheral_template_routes" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "peripheral_template_routes" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- permission_template_items (1)
ALTER TABLE "permission_template_items" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- permission_templates (2)
ALTER TABLE "permission_templates" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "permission_templates" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- permissions (2)
ALTER TABLE "permissions" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "permissions" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- printed_documents (4)
ALTER TABLE "printed_documents" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "printed_documents" ALTER COLUMN "supersededAt" TYPE timestamptz USING "supersededAt" AT TIME ZONE 'UTC';
ALTER TABLE "printed_documents" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "printed_documents" ALTER COLUMN "voidedAt" TYPE timestamptz USING "voidedAt" AT TIME ZONE 'UTC';

-- product_recipe_properties (1)
ALTER TABLE "product_recipe_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- product_recipes (2)
ALTER TABLE "product_recipes" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "product_recipes" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- quality_grades (2)
ALTER TABLE "quality_grades" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "quality_grades" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- return_reasons (2)
ALTER TABLE "return_reasons" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "return_reasons" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- roll_errors (4)
ALTER TABLE "roll_errors" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_errors" ALTER COLUMN "detectedAt" TYPE timestamptz USING "detectedAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_errors" ALTER COLUMN "processedAt" TYPE timestamptz USING "processedAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_errors" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- roll_movements (4)
ALTER TABLE "roll_movements" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_movements" ALTER COLUMN "enteredAt" TYPE timestamptz USING "enteredAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_movements" ALTER COLUMN "exitedAt" TYPE timestamptz USING "exitedAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_movements" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- roll_operations (1)
ALTER TABLE "roll_operations" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- roll_properties (1)
ALTER TABLE "roll_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- roll_returns (3)
ALTER TABLE "roll_returns" ALTER COLUMN "cancelledAt" TYPE timestamptz USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_returns" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "roll_returns" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- rolls (2)
ALTER TABLE "rolls" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "rolls" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- route_steps (2)
ALTER TABLE "route_steps" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "route_steps" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- routes (2)
ALTER TABLE "routes" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "routes" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- sack_allocations (1)
ALTER TABLE "sack_allocations" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- sacks (3)
ALTER TABLE "sacks" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "sacks" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "sacks" ALTER COLUMN "weighedAt" TYPE timestamptz USING "weighedAt" AT TIME ZONE 'UTC';

-- sessions (5)
ALTER TABLE "sessions" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "sessions" ALTER COLUMN "expiresAt" TYPE timestamptz USING "expiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "sessions" ALTER COLUMN "lastSeenAt" TYPE timestamptz USING "lastSeenAt" AT TIME ZONE 'UTC';
ALTER TABLE "sessions" ALTER COLUMN "revokedAt" TYPE timestamptz USING "revokedAt" AT TIME ZONE 'UTC';
ALTER TABLE "sessions" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- shipment_orders (1)
ALTER TABLE "shipment_orders" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- shipments (3)
ALTER TABLE "shipments" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "shipments" ALTER COLUMN "dispatchedAt" TYPE timestamptz USING "dispatchedAt" AT TIME ZONE 'UTC';
ALTER TABLE "shipments" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- station_colors (2)
ALTER TABLE "station_colors" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "station_colors" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- station_properties (2)
ALTER TABLE "station_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "station_properties" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- stations (2)
ALTER TABLE "stations" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "stations" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- subcontractor_categories (2)
ALTER TABLE "subcontractor_categories" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_categories" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- subcontractor_category_links (1)
ALTER TABLE "subcontractor_category_links" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- subcontractor_direct_ship_allocations (1)
ALTER TABLE "subcontractor_direct_ship_allocations" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- subcontractor_dispatch_items (1)
ALTER TABLE "subcontractor_dispatch_items" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- subcontractor_dispatches (5)
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "cancelledAt" TYPE timestamptz USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "directShippedAt" TYPE timestamptz USING "directShippedAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "dispatchedAt" TYPE timestamptz USING "dispatchedAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- subcontractor_receipt_items (1)
ALTER TABLE "subcontractor_receipt_items" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- subcontractor_receipt_properties (1)
ALTER TABLE "subcontractor_receipt_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- subcontractor_receipts (4)
ALTER TABLE "subcontractor_receipts" ALTER COLUMN "cancelledAt" TYPE timestamptz USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_receipts" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_receipts" ALTER COLUMN "receivedAt" TYPE timestamptz USING "receivedAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractor_receipts" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- subcontractors (2)
ALTER TABLE "subcontractors" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "subcontractors" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- swatches (3)
ALTER TABLE "swatches" ALTER COLUMN "cancelledAt" TYPE timestamptz USING "cancelledAt" AT TIME ZONE 'UTC';
ALTER TABLE "swatches" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "swatches" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- system_log_archives (3)
ALTER TABLE "system_log_archives" ALTER COLUMN "archivedAt" TYPE timestamptz USING "archivedAt" AT TIME ZONE 'UTC';
ALTER TABLE "system_log_archives" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "system_log_archives" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- system_logs (2)
ALTER TABLE "system_logs" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "system_logs" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- system_settings (2)
ALTER TABLE "system_settings" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "system_settings" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- traveler_card_scans (2)
ALTER TABLE "traveler_card_scans" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "traveler_card_scans" ALTER COLUMN "scannedAt" TYPE timestamptz USING "scannedAt" AT TIME ZONE 'UTC';

-- traveler_cards (4)
ALTER TABLE "traveler_cards" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "traveler_cards" ALTER COLUMN "printedAt" TYPE timestamptz USING "printedAt" AT TIME ZONE 'UTC';
ALTER TABLE "traveler_cards" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "traveler_cards" ALTER COLUMN "voidedAt" TYPE timestamptz USING "voidedAt" AT TIME ZONE 'UTC';

-- user_permissions (4)
ALTER TABLE "user_permissions" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "user_permissions" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "user_permissions" ALTER COLUMN "validFrom" TYPE timestamptz USING "validFrom" AT TIME ZONE 'UTC';
ALTER TABLE "user_permissions" ALTER COLUMN "validUntil" TYPE timestamptz USING "validUntil" AT TIME ZONE 'UTC';

-- user_preferences (2)
ALTER TABLE "user_preferences" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "user_preferences" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- users (2)
ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- work_order_steps (5)
ALTER TABLE "work_order_steps" ALTER COLUMN "completedAt" TYPE timestamptz USING "completedAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_order_steps" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_order_steps" ALTER COLUMN "startedAt" TYPE timestamptz USING "startedAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_order_steps" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_order_steps" ALTER COLUMN "urgentMarkedAt" TYPE timestamptz USING "urgentMarkedAt" AT TIME ZONE 'UTC';

-- work_order_target_properties (1)
ALTER TABLE "work_order_target_properties" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';

-- work_order_to_order_lines (2)
ALTER TABLE "work_order_to_order_lines" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_order_to_order_lines" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- work_orders (4)
ALTER TABLE "work_orders" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_orders" ALTER COLUMN "plannedEndDate" TYPE timestamptz USING "plannedEndDate" AT TIME ZONE 'UTC';
ALTER TABLE "work_orders" ALTER COLUMN "plannedStartDate" TYPE timestamptz USING "plannedStartDate" AT TIME ZONE 'UTC';
ALTER TABLE "work_orders" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- work_sessions (5)
ALTER TABLE "work_sessions" ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_sessions" ALTER COLUMN "endedAt" TYPE timestamptz USING "endedAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_sessions" ALTER COLUMN "lastActivityAt" TYPE timestamptz USING "lastActivityAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_sessions" ALTER COLUMN "startedAt" TYPE timestamptz USING "startedAt" AT TIME ZONE 'UTC';
ALTER TABLE "work_sessions" ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';
