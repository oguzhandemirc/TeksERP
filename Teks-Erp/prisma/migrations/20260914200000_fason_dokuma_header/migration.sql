-- =============================================================================
-- G2 · FASON DOKUMA — sevk/makbuz başlığı POLİMORFİK (2026-09-14, 01; hüküm 1e)
-- =============================================================================
-- Fason sevki bugüne dek yapısal olarak İŞ EMRİ ADIMINA bağlıydı (workOrderId +
-- stepId + batchId NOT NULL). Dokuma işi bir WorkOrder DEĞİLDİR (rotası/partisi
-- yok); levent/iplik dokuma işi adına fasona gider, TOP makbuzla döner. Yeni
-- belge AÇILMAZ (fason alanı canlı ve zengin): başlık iki koldan tam birine
-- bağlanır, CHECK ikinci hat (birincil kapı serviste, Türkçe mesaj).
--
-- İDEMPOTENT: her ifade yeniden koşulabilir (canlı tabloda NOT NULL düşürme —
-- dolu şemada ikinci deploy ölçüldü). FK'lar DEĞİŞMEZ (ON DELETE RESTRICT kalır);
-- yeni FK'lar da RESTRICT — dokuma işi sevk/makbuz varken silinemez.
-- =============================================================================

-- 1) Sevk başlığı: WO kolonları NULL olabilir + weavingOrderId
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "workOrderId" DROP NOT NULL;
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "stepId" DROP NOT NULL;
ALTER TABLE "subcontractor_dispatches" ALTER COLUMN "batchId" DROP NOT NULL;
ALTER TABLE "subcontractor_dispatches" ADD COLUMN IF NOT EXISTS "weavingOrderId" UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatches_weavingOrderId_fkey') THEN
    ALTER TABLE "subcontractor_dispatches"
      ADD CONSTRAINT "subcontractor_dispatches_weavingOrderId_fkey"
      FOREIGN KEY ("weavingOrderId") REFERENCES "weaving_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "subcontractor_dispatches_weavingOrderId_dispatchedAt_idx"
  ON "subcontractor_dispatches"("weavingOrderId", "dispatchedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatches_header_ck') THEN
    ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_header_ck" CHECK (
      ("workOrderId" IS NOT NULL AND "stepId" IS NOT NULL AND "batchId" IS NOT NULL AND "weavingOrderId" IS NULL)
      OR ("workOrderId" IS NULL AND "stepId" IS NULL AND "batchId" IS NULL AND "weavingOrderId" IS NOT NULL)
    );
  END IF;
END $$;

-- 2) Makbuz başlığı: WO kolonları NULL olabilir + weavingOrderId
ALTER TABLE "subcontractor_receipts" ALTER COLUMN "workOrderId" DROP NOT NULL;
ALTER TABLE "subcontractor_receipts" ALTER COLUMN "stepId" DROP NOT NULL;
ALTER TABLE "subcontractor_receipts" ADD COLUMN IF NOT EXISTS "weavingOrderId" UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipts_weavingOrderId_fkey') THEN
    ALTER TABLE "subcontractor_receipts"
      ADD CONSTRAINT "subcontractor_receipts_weavingOrderId_fkey"
      FOREIGN KEY ("weavingOrderId") REFERENCES "weaving_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "subcontractor_receipts_weavingOrderId_receivedAt_idx"
  ON "subcontractor_receipts"("weavingOrderId", "receivedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipts_header_ck') THEN
    ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_header_ck" CHECK (
      ("workOrderId" IS NOT NULL AND "stepId" IS NOT NULL AND "weavingOrderId" IS NULL)
      OR ("workOrderId" IS NULL AND "stepId" IS NULL AND "weavingOrderId" IS NOT NULL)
    );
  END IF;
END $$;
