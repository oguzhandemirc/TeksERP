-- Gelen belge özet/parti satırında müşterinin parti no'su (yalnız eklemeli, boş olabilir; geçmiş satırlar NULL kalır).
-- AlterTable
ALTER TABLE "customer_delivery_note_lines" ADD COLUMN     "customerBatchNo" VARCHAR(64);

-- Liste araması (`lines.some.customerBatchNo ILIKE`) yalnız parti satırlarını tarasın: kolon yalnız özet/parti satırında dolu
-- (null-yoğun). Ölçüm 300k satır: alt sorgu paralel seq scan 72 ms → bu index ile 2 ms. Yeni kolon boş → kurulum anlık.
CREATE INDEX "customer_delivery_note_lines_customer_batch_idx" ON "customer_delivery_note_lines" ("noteId") WHERE "customerBatchNo" IS NOT NULL;
