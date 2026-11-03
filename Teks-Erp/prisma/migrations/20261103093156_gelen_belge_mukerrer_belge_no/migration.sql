-- Gülkesim K27 (2026-11-03): aynı gönderen belge no + aynı fotoğraf fabrika ayarına bağlandı (`gelenBelge.duplicateDocNo`).
-- (sahip, belge no) partial UNIQUE ve document_scans.sha256 UNIQUE kalkar (WARN/ALLOW'da meşru eş / bitmiş belgenin
-- fotoğrafına yeni kayıt doğar); BLOCK (varsayılan = bugünkü) tekilliği uygulamada 8044/8045 advisory kilidi + kontrol.
-- Yalnız index değişir, veri değişmez; mevcut veri zaten tekil olduğu için BLOCK davranışı aynı kalır.

-- DropIndex
DROP INDEX IF EXISTS "customer_delivery_notes_owner_sender_doc_uq";
DROP INDEX IF EXISTS "document_scans_sha256_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_delivery_notes_owner_sender_doc_idx" ON "customer_delivery_notes"("ownerCustomerId", "senderDocNo");
CREATE INDEX IF NOT EXISTS "document_scans_sha256_createdAt_idx" ON "document_scans"("sha256", "createdAt");
