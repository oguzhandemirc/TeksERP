-- =============================================================================
-- PATRON BULUTU EŞİTLEMESİ (B1) — değişiklik tespitinin DB tarafı
-- =============================================================================
-- YALNIZ EKLER (ADDITIVE): yeni enum + iki yeni tablo + 33 indeks + tetikleyiciler.
-- Mevcut hiçbir kolon, kısıt ya da veri değişmez; `--create-only` çıktısındaki iki
-- DropForeignKey satırı (DEFERRABLE top↔çuval↔sevkiyat FK'ları) SİLİNDİ.
-- Sözleşme: docs/design/PATRON-BULUTU-ESITLEME.md §4.
--
--  ① sync_marks  — satır düzeyi tetikleyicilerin yazdığı SILINDI/KIRLI işaretleri
--                  (telemetri sınıfı; budanır). Silen yolun dili önemsiz, işaret
--                  silmeyle AYNI tx'te commit/rollback olur.
--  ② sync_watermarks — kaynak başına "bulutun onayladığı" filigran (durum tablosu).
--  ③ (filigran, eşitlik bozucu) indeksleri — değişiklik taraması satır değeri
--     karşılaştırmasıyla sayfalanır. `rolls`/`roll_movements` büyük tablodur:
--     kurulum `kur.ps1` migration adımında backend DURMUŞKEN koşar; CONCURRENTLY
--     yazılmaz (Prisma migration tek tx'tir, [DB-26]).
-- İdempotent: her ifade IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS ile.
-- =============================================================================
SET statement_timeout = 0;

-- ── ① enum + sync_marks ──────────────────────────────────────────────────────
DO $sync_enum$
BEGIN
  CREATE TYPE "SyncMarkKind" AS ENUM ('DELETED', 'DIRTY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $sync_enum$;

CREATE TABLE IF NOT EXISTS "sync_marks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tableName" VARCHAR(63) NOT NULL,
    "rowId" UUID NOT NULL,
    "kind" "SyncMarkKind" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "sync_marks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "sync_marks_createdAt_id_idx" ON "sync_marks"("createdAt", "id");
-- Projeksiyon başına tarama (`tableName` = kök tablo) — her tur 24 kez sorulur.
CREATE INDEX IF NOT EXISTS "sync_marks_tableName_createdAt_id_idx" ON "sync_marks"("tableName", "createdAt", "id");

-- ── ② sync_watermarks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sync_watermarks" (
    "id" UUID NOT NULL,
    "source" VARCHAR(160) NOT NULL,
    "watermarkAt" TIMESTAMPTZ,
    "tieBreaker" VARCHAR(200),
    "catalogVersion" INTEGER,
    "digest" VARCHAR(64),
    "retentionFrom" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_watermarks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sync_watermarks_source_key" ON "sync_watermarks"("source");

-- ── ③ filigran indeksleri (29 kaynak + birleştirme defterinin 2 damgası) ───────
CREATE INDEX IF NOT EXISTS "bank_accounts_updatedAt_esitleme_idx" ON "bank_accounts"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "cari_accounts_updatedAt_esitleme_idx" ON "cari_accounts"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "cari_balances_updatedAt_esitleme_idx" ON "cari_balances"("updatedAt", "cariId", "currency");
CREATE INDEX IF NOT EXISTS "cari_transactions_createdAt_esitleme_idx" ON "cari_transactions"("createdAt", "id");
CREATE INDEX IF NOT EXISTS "cash_boxes_updatedAt_esitleme_idx" ON "cash_boxes"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "cash_transactions_updatedAt_esitleme_idx" ON "cash_transactions"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "cheque_events_createdAt_esitleme_idx" ON "cheque_events"("createdAt", "id");
CREATE INDEX IF NOT EXISTS "cheques_updatedAt_esitleme_idx" ON "cheques"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "colors_updatedAt_esitleme_idx" ON "colors"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "customer_branches_updatedAt_esitleme_idx" ON "customer_branches"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "customers_updatedAt_esitleme_idx" ON "customers"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "direct_shipments_updatedAt_esitleme_idx" ON "direct_shipments"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "invoices_updatedAt_esitleme_idx" ON "invoices"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "item_prices_updatedAt_esitleme_idx" ON "item_prices"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "items_updatedAt_esitleme_idx" ON "items"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "merge_operations_createdAt_esitleme_idx" ON "merge_operations"("createdAt", "id");
CREATE INDEX IF NOT EXISTS "merge_operations_revertedAt_esitleme_idx" ON "merge_operations"("revertedAt", "id");
CREATE INDEX IF NOT EXISTS "order_lines_updatedAt_esitleme_idx" ON "order_lines"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "orders_updatedAt_esitleme_idx" ON "orders"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "payments_updatedAt_esitleme_idx" ON "payments"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "roll_movements_updatedAt_esitleme_idx" ON "roll_movements"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "roll_returns_updatedAt_esitleme_idx" ON "roll_returns"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "rolls_updatedAt_esitleme_idx" ON "rolls"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "sacks_updatedAt_esitleme_idx" ON "sacks"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "shipments_updatedAt_esitleme_idx" ON "shipments"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "stations_updatedAt_esitleme_idx" ON "stations"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "subcontractors_updatedAt_esitleme_idx" ON "subcontractors"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "warehouses_updatedAt_esitleme_idx" ON "warehouses"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "work_order_steps_updatedAt_esitleme_idx" ON "work_order_steps"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "work_order_to_order_lines_updatedAt_esitleme_idx" ON "work_order_to_order_lines"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "work_orders_updatedAt_esitleme_idx" ON "work_orders"("updatedAt", "id");

-- ── ④ tetikleyici fonksiyonları ──────────────────────────────────────────────
-- Kök satır silindi: SILINDI işareti; TG_ARGV verilirse (ebeveyn tablo, ebeveyn kolonu)
-- ebeveyn de KIRLI olur (silinen kalem siparişin toplamını değiştirir).
CREATE OR REPLACE FUNCTION sync_mark_deleted() RETURNS trigger LANGUAGE plpgsql AS $sync_mark_deleted$
DECLARE
  parent_id uuid;
BEGIN
  INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES (TG_TABLE_NAME, OLD."id", 'DELETED');
  IF TG_NARGS = 2 THEN
    parent_id := (to_jsonb(OLD) ->> TG_ARGV[1])::uuid;
    IF parent_id IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES (TG_ARGV[0], parent_id, 'DIRTY');
    END IF;
  END IF;
  RETURN NULL;
END
$sync_mark_deleted$;

-- Kök OLMAYAN çocuk satır silindi: yalnız ebeveyn KIRLI (iş emri adımı → iş emri).
CREATE OR REPLACE FUNCTION sync_mark_parent_dirty() RETURNS trigger LANGUAGE plpgsql AS $sync_mark_parent_dirty$
DECLARE
  parent_id uuid;
BEGIN
  parent_id := (to_jsonb(OLD) ->> TG_ARGV[1])::uuid;
  IF parent_id IS NOT NULL THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES (TG_ARGV[0], parent_id, 'DIRTY');
  END IF;
  RETURN NULL;
END
$sync_mark_parent_dirty$;

-- Ayrılma körlüğü (§4.3a): top ebeveyninden AYRILINCA yeni ebeveyn filigrandan görünür,
-- ESKİ ebeveyn görünmez — eski çuval/sevkiyat/iş emri KIRLI işaretlenir.
CREATE OR REPLACE FUNCTION sync_mark_roll_old_parents() RETURNS trigger LANGUAGE plpgsql AS $sync_mark_roll_old_parents$
DECLARE
  wo uuid;
BEGIN
  IF OLD."sackId" IS NOT NULL AND OLD."sackId" IS DISTINCT FROM NEW."sackId" THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('sacks', OLD."sackId", 'DIRTY');
  END IF;
  IF OLD."shipmentId" IS NOT NULL AND OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId" THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('shipments', OLD."shipmentId", 'DIRTY');
  END IF;
  IF OLD."currentStepId" IS NOT NULL AND OLD."currentStepId" IS DISTINCT FROM NEW."currentStepId" THEN
    SELECT s."workOrderId" INTO wo FROM "work_order_steps" s WHERE s."id" = OLD."currentStepId";
    IF wo IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('work_orders', wo, 'DIRTY');
    END IF;
  END IF;
  IF OLD."producedInStepId" IS NOT NULL AND OLD."producedInStepId" IS DISTINCT FROM NEW."producedInStepId" THEN
    SELECT s."workOrderId" INTO wo FROM "work_order_steps" s WHERE s."id" = OLD."producedInStepId";
    IF wo IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('work_orders', wo, 'DIRTY');
    END IF;
  END IF;
  RETURN NULL;
END
$sync_mark_roll_old_parents$;

-- Çuval sevkiyattan çıkarılınca ESKİ sevkiyat KIRLI.
CREATE OR REPLACE FUNCTION sync_mark_sack_old_shipment() RETURNS trigger LANGUAGE plpgsql AS $sync_mark_sack_old_shipment$
BEGIN
  IF OLD."shipmentId" IS NOT NULL AND OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId" THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('shipments', OLD."shipmentId", 'DIRTY');
  END IF;
  RETURN NULL;
END
$sync_mark_sack_old_shipment$;

-- Filigransız tablo (§4.3b): `shipment_orders` ne id ne updatedAt taşır, küme
-- deleteMany + yeniden yazımla yenilenir — her yazım sevkiyatı KIRLI yapar.
CREATE OR REPLACE FUNCTION sync_mark_shipment_orders() RETURNS trigger LANGUAGE plpgsql AS $sync_mark_shipment_orders$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."shipmentId" IS NOT NULL THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('shipments', OLD."shipmentId", 'DIRTY');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."shipmentId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."shipmentId" IS DISTINCT FROM OLD."shipmentId") THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('shipments', NEW."shipmentId", 'DIRTY');
  END IF;
  RETURN NULL;
END
$sync_mark_shipment_orders$;

-- ── ⑤ tetikleyiciler ────────────────────────────────────────────────────────
-- 24 katalog kök tablosunun HER BİRİNE silme işareti (silme yolu ölçülmüş olsun olmasın:
-- statik tarama dinamik delegate, kaskad ve dinamik tablolu silmede kör ölçüldü).
DROP TRIGGER IF EXISTS "items_sync_deleted" ON "items";
CREATE TRIGGER "items_sync_deleted" AFTER DELETE ON "items" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "colors_sync_deleted" ON "colors";
CREATE TRIGGER "colors_sync_deleted" AFTER DELETE ON "colors" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "warehouses_sync_deleted" ON "warehouses";
CREATE TRIGGER "warehouses_sync_deleted" AFTER DELETE ON "warehouses" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "stations_sync_deleted" ON "stations";
CREATE TRIGGER "stations_sync_deleted" AFTER DELETE ON "stations" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "customers_sync_deleted" ON "customers";
CREATE TRIGGER "customers_sync_deleted" AFTER DELETE ON "customers" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "customer_branches_sync_deleted" ON "customer_branches";
CREATE TRIGGER "customer_branches_sync_deleted" AFTER DELETE ON "customer_branches" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "subcontractors_sync_deleted" ON "subcontractors";
CREATE TRIGGER "subcontractors_sync_deleted" AFTER DELETE ON "subcontractors" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "orders_sync_deleted" ON "orders";
CREATE TRIGGER "orders_sync_deleted" AFTER DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "order_lines_sync_deleted" ON "order_lines";
CREATE TRIGGER "order_lines_sync_deleted" AFTER DELETE ON "order_lines" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted('orders', 'orderId');
DROP TRIGGER IF EXISTS "shipments_sync_deleted" ON "shipments";
CREATE TRIGGER "shipments_sync_deleted" AFTER DELETE ON "shipments" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "direct_shipments_sync_deleted" ON "direct_shipments";
CREATE TRIGGER "direct_shipments_sync_deleted" AFTER DELETE ON "direct_shipments" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "sacks_sync_deleted" ON "sacks";
CREATE TRIGGER "sacks_sync_deleted" AFTER DELETE ON "sacks" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted('shipments', 'shipmentId');
DROP TRIGGER IF EXISTS "work_orders_sync_deleted" ON "work_orders";
CREATE TRIGGER "work_orders_sync_deleted" AFTER DELETE ON "work_orders" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "cari_accounts_sync_deleted" ON "cari_accounts";
CREATE TRIGGER "cari_accounts_sync_deleted" AFTER DELETE ON "cari_accounts" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "cari_transactions_sync_deleted" ON "cari_transactions";
CREATE TRIGGER "cari_transactions_sync_deleted" AFTER DELETE ON "cari_transactions" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted('cari_accounts', 'cariId');
DROP TRIGGER IF EXISTS "cash_boxes_sync_deleted" ON "cash_boxes";
CREATE TRIGGER "cash_boxes_sync_deleted" AFTER DELETE ON "cash_boxes" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "bank_accounts_sync_deleted" ON "bank_accounts";
CREATE TRIGGER "bank_accounts_sync_deleted" AFTER DELETE ON "bank_accounts" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "cash_transactions_sync_deleted" ON "cash_transactions";
CREATE TRIGGER "cash_transactions_sync_deleted" AFTER DELETE ON "cash_transactions" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "cheques_sync_deleted" ON "cheques";
CREATE TRIGGER "cheques_sync_deleted" AFTER DELETE ON "cheques" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "cheque_events_sync_deleted" ON "cheque_events";
CREATE TRIGGER "cheque_events_sync_deleted" AFTER DELETE ON "cheque_events" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "invoices_sync_deleted" ON "invoices";
CREATE TRIGGER "invoices_sync_deleted" AFTER DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "invoice_lines_sync_deleted" ON "invoice_lines";
CREATE TRIGGER "invoice_lines_sync_deleted" AFTER DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted('invoices', 'invoiceId');
DROP TRIGGER IF EXISTS "payments_sync_deleted" ON "payments";
CREATE TRIGGER "payments_sync_deleted" AFTER DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "item_prices_sync_deleted" ON "item_prices";
CREATE TRIGGER "item_prices_sync_deleted" AFTER DELETE ON "item_prices" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();

-- Kök olmayan çocuk: bekleyen adım silinince iş emri KIRLI.
DROP TRIGGER IF EXISTS "work_order_steps_sync_deleted" ON "work_order_steps";
CREATE TRIGGER "work_order_steps_sync_deleted" AFTER DELETE ON "work_order_steps" FOR EACH ROW EXECUTE FUNCTION sync_mark_parent_dirty('work_orders', 'workOrderId');

-- Ayrılma körlüğü: yalnız FK DEĞİŞİNCE ateşlenir (sıcak yolda maliyet yok).
DROP TRIGGER IF EXISTS "rolls_sync_parent_moved" ON "rolls";
CREATE TRIGGER "rolls_sync_parent_moved" AFTER UPDATE OF "sackId", "shipmentId", "currentStepId", "producedInStepId" ON "rolls"
  FOR EACH ROW WHEN (OLD."sackId" IS DISTINCT FROM NEW."sackId" OR OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId"
                  OR OLD."currentStepId" IS DISTINCT FROM NEW."currentStepId" OR OLD."producedInStepId" IS DISTINCT FROM NEW."producedInStepId")
  EXECUTE FUNCTION sync_mark_roll_old_parents();
DROP TRIGGER IF EXISTS "sacks_sync_parent_moved" ON "sacks";
CREATE TRIGGER "sacks_sync_parent_moved" AFTER UPDATE OF "shipmentId" ON "sacks"
  FOR EACH ROW WHEN (OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId")
  EXECUTE FUNCTION sync_mark_sack_old_shipment();

-- Filigransız küme: sevkiyat ↔ sipariş.
DROP TRIGGER IF EXISTS "shipment_orders_sync_dirty" ON "shipment_orders";
CREATE TRIGGER "shipment_orders_sync_dirty" AFTER INSERT OR UPDATE OR DELETE ON "shipment_orders"
  FOR EACH ROW EXECUTE FUNCTION sync_mark_shipment_orders();
