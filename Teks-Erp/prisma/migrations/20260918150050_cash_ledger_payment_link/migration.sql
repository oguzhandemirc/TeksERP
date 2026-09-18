-- KASA BAKİYESİ TEK YAZAR (2026-09-18) — 2/3: `cash_transactions.paymentId` (ödeme başına TEK satır) + FK RESTRICT.
-- Şema YALNIZ EKLER; bakiyeye DOKUNMAZ; geçmiş ödemelerin satırı `scripts/migrate_cash_ledger_backfill.ts` ile (kullanıcı koşar).
-- İDEMPOTENT (deploy-kurulum.md): kolon/indeks IF NOT EXISTS, FK duplicate_object yutulur.
-- ⚠️ `migrate diff` çıktısındaki DropForeignKey satırları (DEFERRABLE FK'lar) BİLEREK atıldı.

-- AlterTable
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "paymentId" UUID;

-- CreateIndex (tek satır / ödeme — backfill ikinci koşumda satır açamaz)
CREATE UNIQUE INDEX IF NOT EXISTS "cash_transactions_paymentId_key" ON "cash_transactions"("paymentId");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
