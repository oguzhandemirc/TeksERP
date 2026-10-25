-- =============================================================================
-- MAL-4 — SATIŞ TEKLİFİ + FİYAT LİSTESİ (`sales_quotes`, `sales_quote_lines`, `price_lists`,
-- `price_list_lines`) — 2026-10-25
-- =============================================================================
-- NE YAPAR: dört yeni tablo, üç yeni enum (CREATE TYPE — tipler burada DOĞUYOR, ADD VALUE değil),
-- partial unique'ler, CHECK seddi ve teklifin `statusChangedAt` damga trigger'ı.
-- ADDITIVE: mevcut tabloya kolon/satır dokunulmaz (`orders` dahil — teklif↔sipariş bağı
-- `sales_quotes.convertedOrderId`te); tablolar boş doğar, mevcut kurulumun davranışı değişmez.
--
-- ⚠️ `migrate dev --create-only` çıktısındaki iki `DropForeignKey` satırı (rolls/swatches
-- DEFERRABLE composite FK) SİLİNDİ — datamodel'de temsil edilemezler (test_schema_drift).
-- ⚠️ Partial/ifade unique'leri, CHECK'ler ve trigger ŞEMA-DIŞI: envanter `test_db_invariants`,
-- davranış `test_teklif_durum` / `test_fiyat_listesi`.
-- Plan: docs/design/MALIYET-TEKLIF-PLAN.md §3.2–§3.5.
-- =============================================================================

-- CreateEnum
CREATE TYPE "SalesQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'CONVERTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuotePriceSource" AS ENUM ('COST_PLUS', 'PRICE_LIST', 'ITEM_PRICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "sales_quotes" (
    "id" UUID NOT NULL,
    "quoteNo" VARCHAR(32) NOT NULL,
    "revisionNo" SMALLINT NOT NULL DEFAULT 1,
    "clientToken" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID,
    "quoteDate" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "fxRate" DECIMAL(18,6) NOT NULL,
    "fxRateSource" "ExchangeRateSource",
    "fxRateDate" DATE,
    "paymentTermDays" INTEGER,
    "financeChargePct" DECIMAL(6,2),
    "commissionPct" DECIMAL(6,2),
    "freightPerM" DECIMAL(14,4),
    "customerReference" VARCHAR(100),
    "notes" VARCHAR(1000),
    "internalNote" VARCHAR(1000),
    "status" "SalesQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,
    "sentById" UUID,
    "acceptedAt" TIMESTAMPTZ,
    "acceptedById" UUID,
    "rejectedAt" TIMESTAMPTZ,
    "rejectedById" UUID,
    "rejectReason" VARCHAR(300),
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "convertedOrderId" UUID,
    "convertedAt" TIMESTAMPTZ,
    "convertedById" UUID,
    "revisionOfId" UUID,
    "supersededAt" TIMESTAMPTZ,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCostTry" DECIMAL(14,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "sales_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quote_lines" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID,
    "colorId" UUID,
    "description" VARCHAR(200) NOT NULL,
    "width" DECIMAL(12,3),
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "ItemUnit" NOT NULL DEFAULT 'MT',
    "standardCostVersionId" UUID,
    "costPerMTry" DECIMAL(14,4) NOT NULL,
    "costSnapshot" JSONB NOT NULL,
    "markupPct" DECIMAL(6,2) NOT NULL,
    "suggestedUnitPrice" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "priceSource" "QuotePriceSource" NOT NULL,
    "priceListLineId" UUID,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sales_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "listNo" VARCHAR(32) NOT NULL,
    "revisionNo" SMALLINT NOT NULL DEFAULT 1,
    "clientToken" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "customerId" UUID,
    "currency" "Currency" NOT NULL,
    "status" "PriceListStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATE,
    "validUntil" DATE,
    "publishedAt" TIMESTAMPTZ,
    "publishedById" UUID,
    "archivedAt" TIMESTAMPTZ,
    "archivedById" UUID,
    "revisionOfId" UUID,
    "notes" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_lines" (
    "id" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "colorId" UUID,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "minQty" DECIMAL(12,3),
    "standardCostVersionId" UUID,
    "costPerMTry" DECIMAL(14,4),
    "markupPct" DECIMAL(6,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "price_list_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotes_clientToken_key" ON "sales_quotes"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotes_convertedOrderId_key" ON "sales_quotes"("convertedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotes_revisionOfId_key" ON "sales_quotes"("revisionOfId");

-- CreateIndex
CREATE INDEX "sales_quotes_customerId_idx" ON "sales_quotes"("customerId");

-- CreateIndex
CREATE INDEX "sales_quotes_branchId_idx" ON "sales_quotes"("branchId");

-- CreateIndex
CREATE INDEX "sales_quotes_status_validUntil_idx" ON "sales_quotes"("status", "validUntil");

-- CreateIndex
CREATE INDEX "sales_quotes_quoteDate_idx" ON "sales_quotes"("quoteDate");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotes_quoteNo_revisionNo_key" ON "sales_quotes"("quoteNo", "revisionNo");

-- CreateIndex
CREATE INDEX "sales_quote_lines_itemId_idx" ON "sales_quote_lines"("itemId");

-- CreateIndex
CREATE INDEX "sales_quote_lines_colorId_idx" ON "sales_quote_lines"("colorId");

-- CreateIndex
CREATE INDEX "sales_quote_lines_standardCostVersionId_idx" ON "sales_quote_lines"("standardCostVersionId");

-- CreateIndex
CREATE INDEX "sales_quote_lines_priceListLineId_idx" ON "sales_quote_lines"("priceListLineId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quote_lines_quoteId_lineNo_key" ON "sales_quote_lines"("quoteId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_clientToken_key" ON "price_lists"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_revisionOfId_key" ON "price_lists"("revisionOfId");

-- CreateIndex
CREATE INDEX "price_lists_customerId_idx" ON "price_lists"("customerId");

-- CreateIndex
CREATE INDEX "price_lists_status_currency_idx" ON "price_lists"("status", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_listNo_revisionNo_key" ON "price_lists"("listNo", "revisionNo");

-- CreateIndex
CREATE INDEX "price_list_lines_itemId_idx" ON "price_list_lines"("itemId");

-- CreateIndex
CREATE INDEX "price_list_lines_colorId_idx" ON "price_list_lines"("colorId");

-- CreateIndex
CREATE INDEX "price_list_lines_standardCostVersionId_idx" ON "price_list_lines"("standardCostVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_lines_priceListId_lineNo_key" ON "price_list_lines"("priceListId", "lineNo");

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "sales_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "sales_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_standardCostVersionId_fkey" FOREIGN KEY ("standardCostVersionId") REFERENCES "standard_cost_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_priceListLineId_fkey" FOREIGN KEY ("priceListLineId") REFERENCES "price_list_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_standardCostVersionId_fkey" FOREIGN KEY ("standardCostVersionId") REFERENCES "standard_cost_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── ŞEMA-DIŞI SED (idempotent) ──────────────────────────────────────────────

-- Müşteri + döviz başına TEK yayınlı liste (genel liste müşterisiz: COALESCE sıfır-UUID).
CREATE UNIQUE INDEX IF NOT EXISTS "price_lists_published_uq" ON "price_lists"(COALESCE("customerId", '00000000-0000-0000-0000-000000000000'::uuid), "currency") WHERE "status" = 'PUBLISHED';
-- Liste içinde ürün+renk başına tek satır (renksiz satır sıfır-UUID ile tekilleşir).
CREATE UNIQUE INDEX IF NOT EXISTS "price_list_lines_item_color_uq" ON "price_list_lines"("priceListId", "itemId", COALESCE("colorId", '00000000-0000-0000-0000-000000000000'::uuid));

-- Durum ↔ bağ çift yüklemi: CONVERTED ⇔ sipariş bağı var (tek yazar dönüştürme + DB seddi).
ALTER TABLE "sales_quotes" DROP CONSTRAINT IF EXISTS "sales_quotes_converted_ck";
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_converted_ck" CHECK (("status" = 'CONVERTED') = ("convertedOrderId" IS NOT NULL));
ALTER TABLE "sales_quotes" DROP CONSTRAINT IF EXISTS "sales_quotes_superseded_ck";
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_superseded_ck" CHECK (("status" = 'SUPERSEDED') = ("supersededAt" IS NOT NULL));
ALTER TABLE "sales_quotes" DROP CONSTRAINT IF EXISTS "sales_quotes_fx_rate_ck";
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_fx_rate_ck" CHECK ("fxRate" > 0 AND ("currency" <> 'TRY' OR "fxRate" = 1));
ALTER TABLE "sales_quotes" DROP CONSTRAINT IF EXISTS "sales_quotes_numbers_ck";
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_numbers_ck" CHECK ("revisionNo" > 0 AND "validUntil" >= "quoteDate" AND "totalAmount" >= 0 AND ("totalCostTry" IS NULL OR "totalCostTry" >= 0) AND ("paymentTermDays" IS NULL OR "paymentTermDays" >= 0) AND ("freightPerM" IS NULL OR "freightPerM" >= 0));
ALTER TABLE "sales_quotes" DROP CONSTRAINT IF EXISTS "sales_quotes_pct_ck";
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_pct_ck" CHECK (("financeChargePct" IS NULL OR ("financeChargePct" >= 0 AND "financeChargePct" <= 100)) AND ("commissionPct" IS NULL OR ("commissionPct" >= 0 AND "commissionPct" < 100)));
ALTER TABLE "sales_quote_lines" DROP CONSTRAINT IF EXISTS "sales_quote_lines_amounts_ck";
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_amounts_ck" CHECK ("lineNo" > 0 AND "quantity" > 0 AND "unitPrice" >= 0 AND "costPerMTry" >= 0 AND "suggestedUnitPrice" >= 0 AND "lineTotal" >= 0 AND ("width" IS NULL OR "width" > 0));
ALTER TABLE "sales_quote_lines" DROP CONSTRAINT IF EXISTS "sales_quote_lines_markup_ck";
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_markup_ck" CHECK ("markupPct" > -100 AND "markupPct" <= 1000);
ALTER TABLE "price_lists" DROP CONSTRAINT IF EXISTS "price_lists_published_ck";
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_published_ck" CHECK (("status" = 'DRAFT') = ("publishedAt" IS NULL) AND ("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL) AND "revisionNo" > 0);
ALTER TABLE "price_list_lines" DROP CONSTRAINT IF EXISTS "price_list_lines_amounts_ck";
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_amounts_ck" CHECK ("lineNo" > 0 AND "unitPrice" >= 0 AND ("minQty" IS NULL OR "minQty" > 0) AND ("costPerMTry" IS NULL OR "costPerMTry" >= 0) AND ("markupPct" IS NULL OR ("markupPct" > -100 AND "markupPct" <= 1000)));

-- `statusChangedAt` TEK yazma noktası: yalnız durum GERÇEKTEN değişince (not/tutar dokunuşu değil).
-- Çıplak now() doğru: kolon timestamptz (mutlak an).
CREATE OR REPLACE FUNCTION "sales_quotes_stamp_status_changed"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."statusChangedAt" := now();
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."statusChangedAt" := now();
  ELSE
    NEW."statusChangedAt" := OLD."statusChangedAt";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sales_quotes_status_changed" ON "sales_quotes";
CREATE TRIGGER "sales_quotes_status_changed"
  BEFORE INSERT OR UPDATE ON "sales_quotes"
  FOR EACH ROW EXECUTE FUNCTION "sales_quotes_stamp_status_changed"();
