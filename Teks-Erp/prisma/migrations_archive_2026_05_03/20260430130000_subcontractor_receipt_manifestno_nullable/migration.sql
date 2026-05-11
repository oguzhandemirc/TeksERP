-- =============================================================================
-- SubcontractorReceipt.manifestNo opsiyonel — fason firma her zaman irsaliye
-- vermeyebilir, kabul akışı bu olmadan da yapılabilmeli.
-- =============================================================================

ALTER TABLE "subcontractor_receipts"
  ALTER COLUMN "manifestNo" DROP NOT NULL;
