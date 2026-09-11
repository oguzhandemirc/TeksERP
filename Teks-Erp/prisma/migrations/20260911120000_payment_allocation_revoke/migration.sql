-- =============================================================================
-- Fatura kapamasını ÇÖZME artık silmez, damgalar (defter-öncelikli doktrin, B-3)
-- =============================================================================
-- Eskiden `deallocate` ve toplu storno satırı FİZİKSEL siliyordu: üç sayaç
-- (Invoice.paidTotal · Payment.allocatedTotal · Cheque.allocatedTotal) düşüyor,
-- geriye hiçbir satır kalmıyordu → "fatura ne zaman kapandı, ne zaman kim açtı"
-- cevapsızdı.
--
-- ⚠️ NEGATİF TERS SATIR YAZILAMAZ: `payment_allocations_amount_positive` CHECK'i
-- var, yani `CariTransaction.reversesTxnId` deseni buraya uygulanamaz. Doğru yol
-- DAMGADIR; okuyan her yol `revokedAt IS NULL` süzer.
--
-- GÜVENLİ: üç NULLABLE kolon + index takası. Mevcut satırlara dokunulmaz
-- (hepsi `revokedAt IS NULL` = aktif olarak doğar, bugünkü davranış korunur).
-- =============================================================================

ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);

-- Aktif kapama sorguları iki kolonla süzer; çözülmüş satır zamanla birikir ve
-- tek kolonlu index onu her turda taramaya bırakırdı.
CREATE INDEX IF NOT EXISTS "payment_allocations_invoiceId_revokedAt_idx"
  ON "payment_allocations" ("invoiceId", "revokedAt");
CREATE INDEX IF NOT EXISTS "payment_allocations_paymentId_revokedAt_idx"
  ON "payment_allocations" ("paymentId", "revokedAt");
CREATE INDEX IF NOT EXISTS "payment_allocations_chequeId_revokedAt_idx"
  ON "payment_allocations" ("chequeId", "revokedAt");

DROP INDEX IF EXISTS "payment_allocations_invoiceId_idx";
DROP INDEX IF EXISTS "payment_allocations_paymentId_idx";
DROP INDEX IF EXISTS "payment_allocations_chequeId_idx";
