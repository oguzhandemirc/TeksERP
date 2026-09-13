-- =============================================================================
-- DOKUMA İŞİ — `weaving_orders` (2026-09-13, dokuma Faz 1 · P1)
-- =============================================================================
-- NE YAPIYOR: bir tablo + iki pg enum yaratır.
--   WeavingExecutionKind  IN_HOUSE | SUBCONTRACTED
--   WeavingOrderStatus    PLANNED | IN_PROGRESS | COMPLETED | CANCELLED
--
-- ADDITIVE Mİ: EVET, tamamen. Var olan hiçbir tabloya/kolona DOKUNMAZ; yalnız
--   yeni nesne ekler. Geri alma = tabloyu düşürmek (henüz satır yok).
--
-- ⚠️ DOKUMA TOPUN ROTASINDA BİR ADIM DEĞİLDİR — topu DOĞURAN ayrı bir varlıktır
--   (kullanıcı ölçütü 2026-09-13). Bu tablo bir `work_orders` kopyası DEĞİL:
--   rota/adım taşımaz, toplarla FK'sı yoktur. Top KK1'de doğar.
--   Gerekçe: docs/design/DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md §1
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya elle yazıldı; `migrate dev`
--   koşulmadı — iki DEFERRABLE composite FK'yı düşürmesin).
--
-- XOR KISITI BİLİNÇLİ OLARAK BU MİGRATION'DA YOK: `executionKind` ile
--   `subcontractorId` arasındaki XOR birincil olarak SERVİS kapısında doğrulanır
--   (`resolveSupplierParty` kalıbı). DB CHECK ikinci hattır ve yazma yüzeyiyle
--   AYNI dilimde iner — kapısız bir CHECK, yazanı olmayan bir kısıttır.
--
-- İNDEKSLER: dördü domain FK'sı ([DB-12]), biri ekran sorgusu (eşitlik önce).
--   Künye FK'ları (`createdById`/`updatedById`/`closedById`/`cancelledById`)
--   BİLİNÇLİ INDEXSİZ ve FK'sız — "kim yaptı" alanı üstünde süzme yapılmaz
--   ([DB-11], 91 emsal).
-- =============================================================================

CREATE TYPE "WeavingExecutionKind" AS ENUM ('IN_HOUSE', 'SUBCONTRACTED');
CREATE TYPE "WeavingOrderStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "weaving_orders" (
  "id"                 UUID          NOT NULL,
  "weavingOrderNumber" VARCHAR(64)   NOT NULL,
  "clientToken"        UUID,
  "itemId"             UUID          NOT NULL,
  "colorId"            UUID,
  "warpSpecId"         UUID,
  "plannedM"           NUMERIC(12,3),
  "executionKind"      "WeavingExecutionKind" NOT NULL,
  "subcontractorId"    UUID,
  "status"             "WeavingOrderStatus"   NOT NULL DEFAULT 'PLANNED',
  "plannedStartDate"   TIMESTAMPTZ,
  "plannedEndDate"     TIMESTAMPTZ,
  "notes"              VARCHAR(500),
  "closedAt"           TIMESTAMPTZ,
  "closedById"         UUID,
  "cancelledAt"        TIMESTAMPTZ,
  "cancelledById"      UUID,
  "cancelReason"       VARCHAR(300),
  "createdAt"          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ   NOT NULL,
  "createdById"        UUID,
  "updatedById"        UUID,
  CONSTRAINT "weaving_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "weaving_orders_weavingOrderNumber_key" ON "weaving_orders"("weavingOrderNumber");
CREATE UNIQUE INDEX "weaving_orders_clientToken_key"        ON "weaving_orders"("clientToken");
CREATE INDEX "weaving_orders_status_plannedStartDate_idx"   ON "weaving_orders"("status", "plannedStartDate");
CREATE INDEX "weaving_orders_itemId_idx"                    ON "weaving_orders"("itemId");
CREATE INDEX "weaving_orders_colorId_idx"                   ON "weaving_orders"("colorId");
CREATE INDEX "weaving_orders_warpSpecId_idx"                ON "weaving_orders"("warpSpecId");
CREATE INDEX "weaving_orders_subcontractorId_idx"           ON "weaving_orders"("subcontractorId");

ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_colorId_fkey"
  FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_warpSpecId_fkey"
  FOREIGN KEY ("warpSpecId") REFERENCES "warp_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_subcontractorId_fkey"
  FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
