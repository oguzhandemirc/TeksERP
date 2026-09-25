-- =============================================================================
-- Batch.clientToken — "Parti Ekle" ucunun idempotency anahtarı (iş emri hareket defteri D8)
-- =============================================================================
-- GÜVENLİ / ADDITIVE: nullable kolon + tekil indeks; mevcut satırlar NULL kalır. İdempotent.
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "clientToken" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "batches_clientToken_key" ON "batches"("clientToken");
